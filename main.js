// Copyright (c) 2021 The Khronos Group Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// Grab all DOM objects
const disassembleDiv = document.getElementById("disassembleDiv");

// Tracking Information per parse
var functionList = [];
var blockList = [];
// Main map of all items with instruction index as key
var instructionMap = new Map();
// A mapping of the resultID to the instruction index
var resultToInstructionMap = new Map();
// Map of where all branch/switches jump too. Value is array of Label IDs
var branchMap = new Map();
// 2D array with key being an ID
//    value is array of all instructions that use it
var idConsumers = [];
// Mapping of all results to an opName string
var opNameMap = new Map();
// Mapping of resultId to extended instructions literal name
var resultToExtInstructionName = new Map();

// Ensures consecutive loads are cleared
function resetTracking() {
    functionList = [];
    blockList = [];
    instructionMap = new Map();
    resultToInstructionMap = new Map();
    branchMap = new Map();
    idConsumers = [];
    opNameMap = new Map();
    resultToExtInstructionName = new Map();
}

// @param binary ArrayBuffer of spirv module binary file
function parseBinaryStream(binary) {
    const performanceStart = performance.now();

    // Clear div from any previous run
    disassembleDiv.innerHTML = "";
    // clear previous SVG
    d3.select("#dagSvg").selectAll("*").remove();
    resetTracking();

    // translate to Uint32 array to match each SPIR-V dword
    assert(binary.byteLength % 4 == 0, "File is not 4 byte (32 bit) aligned, are you sure this is a binary SPIR-V file?");
    const module = new Uint32Array(binary);
    delete binary;

    assert(module.length >= 5, "module less than 5 dwords which is the size of the header");

    validateHeader(module.slice(0, 5));
    const maxIdBound = module[3];
    for (let i = 0; i < maxIdBound; i++) {
        idConsumers[i] = [];
    }

    // Basic iterator mechanism, needs to reset each pass
    var instructionCount = 0;

    // internal representation of the module
    // Built up in first pass
    var currentFunction = {
        "start" : 0,
        "end" : 0
    };
    var currentBlock = {
        "start" : 0,
        "end" : 0,
        "function" : 0
    };

    // all instructions before first function are by themselves in "preFunciton"
    // Set preFunction div the same way as a normal function
    var preFunctionDiv = document.createElement("div");
    addCollapsibleWrapper(preFunctionDiv, disassembleDiv, "preFunction", "preFunction");

    // div hierarchy
    // disassembleDiv -> function -> label -> instructions
    var currentInstructionDiv = preFunctionDiv;
    var currentFunctionDiv = undefined;

    // How much each basic block will indent by
    var indentStack = [];
    const indentMultipler = 10; // pixel

    // There is a 2 pass system through the stream
    //   First pass: Setup all the DOM elements
    //   Second pass: Edit the DOM elements
    // This 2nd pass makes looking ahead in CFG ops much easier

    // First pass
    for (let i = 5; i < module.length;) {
        var instruction = module[i];
        var instructionLength = instruction >> spirvMeta.WordCountShift;
        var opcode = instruction & spirvMeta.OpCodeMask;

        // Get type and result according to instruction layout
        var hasResultType = opcodeHasResultType(opcode);
        var hasResult = opcodeHasResult(opcode);
        var opcodeResultType = hasResultType ? module[i + 1] : undefined;
        var opcodeResult = hasResult ? (hasResultType ? module[i + 2] :  module[i + 1]) : undefined;
        // Holds operands that are an id (non-literals)
        var operandIdList = [];

        // Handles all aspects related to CFG
        {
            // Manage indent level from nested cfg
            // Need to be done prior to label getting assigned CSS style
            switch (opcode) {
                case spirvEnum.Op.OpLoopMerge:
                case spirvEnum.Op.OpSelectionMerge:
                    indentStack.push(module[i + 1]);
                    break;
                case spirvEnum.Op.OpLabel:
                    if (indentStack[indentStack.length - 1] == module[i + 1]) {
                        indentStack.pop();
                    }
                    break;
            }
            assert(indentStack.length < 1024, "Control-flow nesting depth limit hit (or infinite loop bug code)")

            // Map the boundaries for functions and blocks
            switch (opcode) {
                case spirvEnum.Op.OpFunction:
                    currentFunction.start = instructionCount;

                    var newDiv = document.createElement("div");
                    addCollapsibleWrapper(newDiv, disassembleDiv, instructionCount, "function");

                    currentFunctionDiv = newDiv;
                    currentInstructionDiv = newDiv;
                    break;
                case spirvEnum.Op.OpFunctionEnd:
                    currentFunction.end = instructionCount;
                    functionList.push(currentFunction);

                    // Label has ended and need to add last instruction
                    currentInstructionDiv = currentFunctionDiv
                    break;
                case spirvEnum.Op.OpLabel:
                    currentBlock.start = instructionCount;
                    currentBlock.function = currentFunction.start;

                    var newDiv = document.createElement("div");

                    assert(currentFunctionDiv, "OpLabel not in a function block");
                    addCollapsibleWrapper(newDiv, currentFunctionDiv, instructionCount, "label");

                    // Set index for both div and the collasible label
                    var indentSize = ((indentStack.length * indentMultipler) + 5);
                    newDiv.style.marginLeft = indentSize + "px";
                    newDiv.parentNode.previousElementSibling.style.marginLeft = indentSize + "px";

                    currentInstructionDiv = newDiv;
                    break;
                case spirvEnum.Op.OpBranch:
                case spirvEnum.Op.OpBranchConditional:
                case spirvEnum.Op.OpSwitch:
                case spirvEnum.Op.OpReturn:
                case spirvEnum.Op.OpReturnValue:
                case spirvEnum.Op.OpKill:
                case spirvEnum.Op.OpUnreachable:
                case spirvEnum.Op.TerminateInvocation:
                    currentBlock.end = instructionCount;
                    blockList.push(currentBlock);
                    break;
            };

            // Build branching map
            var branchDestinations = [];
            switch (opcode) {
                case spirvEnum.Op.OpBranch:
                    branchDestinations.push(module[i + 1]);
                    break;
                case spirvEnum.Op.OpBranchConditional:
                    branchDestinations.push(module[i + 2]);
                    branchDestinations.push(module[i + 3]);
                    break;
                case spirvEnum.Op.OpSwitch:
                    branchDestinations.push(module[i + 2]);
                    for (let operand = 4; operand < instructionLength; operand += 2) {
                        branchDestinations.push(module[i + operand]);
                    }
                    break;
            }
            if (branchDestinations.length > 0) {
                branchMap.set(instructionCount, branchDestinations);
            }
        }

        // Map extended instruction to result hashmap
        if (opcode == spirvEnum.Op.OpExtInstImport) {
            var extendedName = getLiteralString(module.slice(i + 2, i + instructionLength));
            if (extendedName == "GLSL.std.450") {
                resultToExtInstructionName.set(opcodeResult, ExtInstTypeGlslStd450);
            } else if (extendedName == "OpenCL.std") {
                resultToExtInstructionName.set(opcodeResult, ExtInstTypeOpenCLStd);
            } else if (extendedName == "NonSemantic.DebugPrintf") {
                resultToExtInstructionName.set(opcodeResult, ExtInstTypeNonSemanitcDebugPrintf);
            } else if ((extendedName == "NonSemantic.ClspvReflection") || (extendedName == "NonSemantic.ClspvReflection.1")) {
                resultToExtInstructionName.set(opcodeResult, ExtInstTypeNonSemanitcClspvReflection);
            } else if (extendedName == "DebugInfo") {
                resultToExtInstructionName.set(opcodeResult, ExtInstTypeDebugInfo);
            } else if (extendedName == "OpenCL.DebugInfo.100") {
                resultToExtInstructionName.set(opcodeResult, ExtInstTypeOpenCLDebug100);
            } else {
                alert("Full support for " + extendedName + " has not been added. Good chance things might break. Please report!");
            }
        }

        // Handles all aspect of disassembling the module
        {
            // HTML string to display
            // ex. "[19]  %13 = OpTypeFunction %12"
            var instructionString = "<span class=\"count\">[" + instructionCount + "]</span>&emsp;";

            // Handle the result and type as always will be in front
            if (hasResult == true) {
                instructionString += " "
                instructionString += createIdHtmlString(opcodeResult, "result");
                instructionString += " = "
                resultToInstructionMap.set(opcodeResult, instructionCount);
            }

            instructionString += " <a class=\"operation\">" + mapValueToEnumKey(spirvEnum.Op, opcode) + "</a>"

            if (hasResultType == true) {
                instructionString += " "
                instructionString += createIdHtmlString(opcodeResultType, "resultType");
                idConsumers[opcodeResultType].push(instructionCount);
                operandIdList.push(opcodeResultType);
            }

            // index of array of operands from grammar file array
            var grammarOperandIndex = 0;

            // Where in instruction currently in terms of word
            var operandOffset = 1; // first dword is not a operand

            // This list is per instruction. It can't be per opcode as some are variable length instructions
            // which results 2 uses of the same opcode have a different length array later
            var operandNameList = [];

            // When a OpExtInst is used, the operands are pull from the extended instruction grammar file instead
            var extendedOperandInfo = undefined;
            var extendedOperandIndex = 0;

            // When any operand_kinds item in the grammar has a set of parameters
            var parameterOperandInfo = undefined;
            var parameterOperandIndex = 0;
            // Some instructions will have multiple parameter operands and need to iterate through each
            var parameterOperandQueue = [];

            // These need to be set outside the while loop for optionalArray to just reuse
            // the last type of operand for the rest of the instructions
            var optionalArray = false;
            var operandInfo;

            if (hasResultType == true) {
                operandOffset++;
                grammarOperandIndex++;
                operandNameList.push("Result Type");
            }
            if (hasResult == true) {
                operandOffset++
                grammarOperandIndex++;
            }

            // This loop builds the instruction string using the operands
            // Handles all cases that occur in grammar json files
            while(operandOffset < instructionLength) {
                var operand = module[i + operandOffset];
                var instructionInfo = spirvInstruction.get(opcode);

                // Need to know where the current operand should be grabbed from
                if (optionalArray) {
                    // will use the same operandInfo for rest of loop
                    // makes assumption any parametarized operands are at end of instruction
                } else if (extendedOperandInfo) {
                    operandInfo = extendedOperandInfo.operands[extendedOperandIndex];
                    extendedOperandIndex++;
                } else if (parameterOperandInfo) {
                    operandInfo = parameterOperandInfo[parameterOperandIndex];
                    parameterOperandIndex++;

                    // if multiple sets of parameters, resets for next set
                    if (parameterOperandInfo.length == parameterOperandIndex) {
                        // will be undefined if empty, which is find as should exit while loop next
                        parameterOperandInfo = parameterOperandQueue.shift();
                        parameterOperandIndex = 0;
                    }
                } else {
                    // Normal
                    operandInfo = instructionInfo.operands[grammarOperandIndex];
                    grammarOperandIndex++;
                }

                // "some" Grammar files stores names as "'name'" and want to remove string quote
                // Fall back to the 'kind' string if no name string
                assert(operandInfo != undefined, "Unable to find operands from grammar file");
                var operandName;
                if (operandInfo.name) {
                    operandName = (operandInfo.name[0] == "'") ? operandInfo.name.substring(1, operandInfo.name.length-1) : operandInfo.name;
                } else {
                    operandName = operandInfo.kind;
                }

                optionalArray = (operandInfo.quantifier == "*");
                var kind = operandInfo.kind;

                if ((kind == "IdResultType") || (kind == "IdResult")) {
                    assert(false, "Should not have to handle IdResultType or IdResult here");
                } else if (kind == "IdRef") {
                    // handle optional array as speical case for IdRef
                    if (optionalArray) {
                        // some name start listing items instead of being just the name
                        // Example: "'Member 0 type', +\n'member 1 type', +\n..."
                        // but note the first and last char were stripped above
                        var endIndex = operandName.indexOf("'");
                        if (endIndex != -1) {
                            operandName = operandName.substring(0, endIndex);
                            operandName = operandName.replace(/ [0-9]/g, ''); // remove number if one
                        }
                        // Finish rest of words
                        var quantifierIndex = 0;
                        while(operandOffset < instructionLength) {
                            instructionString += " "
                            instructionString += createIdHtmlString(module[i + operandOffset], "operand");
                            idConsumers[module[i + operandOffset]].push(instructionCount);
                            operandIdList.push(module[i + operandOffset]);
                            operandOffset++;

                            operandNameList.push(operandName + " " + quantifierIndex);
                            quantifierIndex++;
                        }
                    } else {
                        // if optional (quantifier == "?"), print as normal
                        instructionString += " "
                        instructionString += createIdHtmlString(operand, "operand");
                        idConsumers[operand].push(instructionCount);
                        operandIdList.push(operand);
                        operandNameList.push(operandName);
                        operandOffset++;
                    }

                } else if (kind == "LiteralString") {
                    instructionString += " <span class=\"operand literal\">\""
                    instructionString += getLiteralString(module.slice(i + operandOffset, i + instructionLength));
                    instructionString += "\"</span>"
                    operandNameList.push(operandName);
                    break; // always at end

                } else if (kind == "LiteralInteger") {
                    // single word literal
                    instructionString += " <span class=\"operand literal\">" + operand + "</span>";
                    operandNameList.push(operandName);
                    operandOffset++;

                } else if (kind == "LiteralExtInstInteger") {
                    assert(opcode == spirvEnum.Op.OpExtInst, "Makes assumption OpExtInst is only opcode with LiteralExtInstInteger");
                    // single word literal but from extended instruction set
                    var set = module[i + 3]
                    var extendedSet = resultToExtInstructionName.get(set);

                    // This will have the while loop use the extended grammar
                    extendedOperandInfo = spirvExtInst.get(extendedSet).get(operand);
                    instructionString += " <span class=\"operand literal\">" + extendedOperandInfo.opname + "</span>";
                    operandNameList.push(operandName);
                    operandOffset++;

                } else if (kind == "LiteralSpecConstantOpInteger") {
                    instructionString += " <span class=\"operand literal\">" + spirvInstruction.get(module[i + operandOffset]).opname + "</span>";
                    operandNameList.push(operandName);
                    operandOffset++;

                    var quantifierIndex = 0;
                    while(operandOffset < instructionLength) {
                        instructionString += " "
                        instructionString += createIdHtmlString(module[i + operandOffset], "operand");
                        idConsumers[module[i + operandOffset]].push(instructionCount);
                        operandIdList.push(module[i + operandOffset]);
                        operandOffset++;

                        operandNameList.push("Operand " + quantifierIndex);
                        quantifierIndex++;
                    }

                } else if (kind == "LiteralContextDependentNumber") {
                    // Handle any opcodes that have context dependent operands
                    var width = 1;
                    var operandValue = operand;
                    if (opcode == spirvEnum.Op.OpConstant || opcode == spirvEnum.Op.OpSpecConstant) {
                        // Result Type must be a scalar integer type or floating-point type.
                        var contextInstruction = instructionMap.get(resultToInstructionMap.get(module[i + 1]));
                        if (contextInstruction.opcode == spirvEnum.Op.OpTypeInt) {
                            // 4 instrutions is a normal 32 bit width, extra instruction length is another byte
                            width = instructionLength - 3;
                            assert(width <= 2, "parsing " + 32 * width + " bit int is not supported");
                            if (width == 2) {
                                // 64-bit Int
                                // use toString to get rid of suffix from types of BigInt
                                operandValue = ((BigInt(module[i+4]) << BigInt(32)) + BigInt(module[i+3])).toString();
                            }
                        } else if (contextInstruction.opcode == spirvEnum.Op.OpTypeFloat) {
                            // 4 instrutions is a normal 32 bit width, extra instruction length is another byte
                            width = instructionLength - 3;
                            assert(width <= 2, "parsing " + 32 * width + " bit float is not supported");
                            var lowBits = module[i+3].toString(2);
                            lowBits = new Array(32 - lowBits.length).fill('0').join("") + lowBits;
                            if (width == 2) {
                                // 64-bit Float
                                var highBits = module[i+4].toString(2);
                                highBits = new Array(32 - highBits.length).fill('0').join("") + highBits;
                                bits = highBits + lowBits;
                                operandValue = parseFloatString(bits);
                            } else {
                                // 32-bit float
                                operandValue = parseFloatString(lowBits);
                            }
                        } else {
                            assert(false, "OpConstant/OpSpecConstant result type is not OpTypeInt or OpTypeFloat");
                        }
                    } else {
                        assert(false, "unknown opcode is using LiteralContextDependentNumber grammar, chance things might break now")
                    }

                    instructionString += " <span class=\"operand literal\">" + operandValue + "</span>";
                    operandNameList.push(operandName);
                    operandOffset += width;

                } else if ((kind == "IdMemorySemantics") || (kind == "IdScope")) {
                    instructionString += " "
                    instructionString += createIdHtmlString(operand, "operand");
                    idConsumers[operand].push(instructionCount);
                    operandIdList.push(operand);
                    operandNameList.push(operandName);
                    operandOffset++;

                } else if ((kind == "PairLiteralIntegerIdRef") || (kind == "PairIdRefLiteralInteger") || (kind == "PairIdRefIdRef")) {
                    // All share the same logic of finshing rest of words 2 operands at a time
                    var quantifierIndex = 0;
                    while(operandOffset < instructionLength) {
                        if (opcode == spirvEnum.Op.OpSwitch) {
                            instructionString += " (Case ";
                            instructionString += " <span class=\"operand literal\">" + module[i + operandOffset] + "</span>";
                            instructionString += ": ";
                            instructionString += createIdHtmlString(module[i + operandOffset + 1], "operand");
                            instructionString += ") ";

                            idConsumers[module[i + operandOffset + 1]].push(instructionCount);
                            operandIdList.push(module[i + operandOffset + 1]);

                            operandNameList.push("Case");
                            operandNameList.push("Id");
                        }
                        if (opcode == spirvEnum.Op.OpGroupMemberDecorate) {
                            instructionString += " ( ";
                            instructionString += createIdHtmlString(module[i + operandOffset], "operand");
                            instructionString += ": ";
                            instructionString += "<span class=\"operand literal\">" + module[i + operandOffset + 1] + "</span>";
                            instructionString += ") ";

                            idConsumers[module[i + operandOffset]].push(instructionCount);
                            operandIdList.push(module[i + operandOffset]);

                            operandNameList.push("Id " + quantifierIndex);
                            operandNameList.push("Member " + quantifierIndex);
                        }
                        if (opcode == spirvEnum.Op.OpPhi) {
                            instructionString += " (";
                            instructionString += createIdHtmlString(module[i + operandOffset], "operand");
                            instructionString += ": ";
                            instructionString += createIdHtmlString(module[i + operandOffset + 1], "operand");
                            instructionString += ") ";

                            idConsumers[module[i + operandOffset]].push(instructionCount);
                            idConsumers[module[i + operandOffset + 1]].push(instructionCount);
                            operandIdList.push(module[i + operandOffset]);
                            operandIdList.push(module[i + operandOffset + 1]);

                            operandNameList.push("Variable " + quantifierIndex);
                            operandNameList.push("Parent " + quantifierIndex);
                        }
                        operandOffset += 2;
                        quantifierIndex++;
                    }
                } else {
                    operandInfo = spirvOperand.get(kind);
                    // If extended instruction might need to check grammar file
                    if (!operandInfo && extendedOperandInfo) {
                        var set = module[i + 3]
                        var extendedSet = resultToExtInstructionName.get(set);
                        operandInfo = spirvExtOperand.get(extendedSet).get(kind);
                    }
                    assert(operandInfo != undefined, "Unknown grammar 'kind' of " + kind);

                    if (operandInfo.enumerants) {
                        var enumerantsLength = operandInfo.enumerants.length;
                        var bitEnumString = "";
                        var foundValue = false;

                        for (let i = 0; i < enumerantsLength; i++) {
                            var value = operandInfo.enumerants[i].value;
                            if (operandInfo.category == "BitEnum") {
                                value = parseInt(operandInfo.enumerants[i].value, 16);
                                // Will need to test each item if BitEnum
                                // need to catch case where value and operand are both zero
                                if (((value & operand) != 0) || (value == operand)){
                                    // know at least one value found
                                    if (foundValue == false) {
                                        bitEnumString = operandInfo.enumerants[i].enumerant;
                                    } else {
                                        bitEnumString += " | " + operandInfo.enumerants[i].enumerant;
                                    }

                                    if (operandInfo.enumerants[i].parameters) {
                                        parameterOperandQueue.push(operandInfo.enumerants[i].parameters);
                                    }
                                    foundValue = true;
                                }
                            } else if (value == operand) {
                                // Expect a single value, not flags if not BitEnum
                                instructionString += " <span class=\"operand enumerant\">" + operandInfo.enumerants[i].enumerant + "</span>";

                                if (operandInfo.enumerants[i].parameters) {
                                    parameterOperandQueue.push(operandInfo.enumerants[i].parameters);
                                }
                                foundValue = true;
                                break;
                            }
                        }

                        if (foundValue == true) {
                            operandOffset++;
                            operandNameList.push(operandName);

                            // If any parameter was found, enqueue it right away
                            if (parameterOperandQueue.length != 0) {
                                parameterOperandInfo = parameterOperandQueue.shift();
                            }

                            // Need to formulate string after finding all enums as well as counter operand
                            if (operandInfo.category == "BitEnum") {
                                instructionString += " <span class=\"operand enumerant\">" + bitEnumString + "</span>";
                            }
                        }
                    }
                }
            }

            // Create instruction div
            var newDiv = document.createElement("div");
            newDiv.innerHTML = instructionString
            newDiv.setAttribute("id", "instruction_" + instructionCount);
            newDiv.setAttribute("class", "instruction");
            currentInstructionDiv.appendChild(newDiv);
        }

        // Handles all decorations and names
        {
            if (opcode == spirvEnum.Op.OpName) {
                var name = getLiteralString(module.slice(i + 2, i + instructionLength));
                // strings can be empty according to specs definition of Literals
                // to prevent looking like a bug, replace with some more visual
                if (name == "") {
                    name = "[empty string]"
                }

                opNameMap.set(module[i + 1], name);
            }
        }

        // After parsing instruction insertions/updates
        instructionMap.set(instructionCount, {
            "block" : currentBlock.start,
            "function" : currentFunction.start,
            "opcode" : opcode,
            "result": opcodeResult,
            "resultType": opcodeResultType,
            "operandNameList" : operandNameList,
            "operandIdList" : operandIdList,
            "parentInstructions" : []
        });

        i += instructionLength;
        instructionCount++;
    }

    instructionCount = 0;

    // Second pass
    for (var i = 5; i < module.length;) {
        var instruction = module[i];
        var length = instruction >> spirvMeta.WordCountShift;
        var opcode = instruction & spirvMeta.OpCodeMask;

        var currentInstruction = instructionMap.get(instructionCount)

        // Add extra class to blocks for CFG
        switch (opcode) {
            case spirvEnum.Op.OpLoopMerge:
                var headerBlock = currentInstruction.block;
                var mergeBlock = (instructionMap.get(resultToInstructionMap.get(module[i + 1]))).block;
                var continueBlock = (instructionMap.get(resultToInstructionMap.get(module[i + 2]))).block;
                document.getElementById("label-" + headerBlock).className += (" loopHeaderBlock-" + headerBlock);
                document.getElementById("label-" + mergeBlock).className += (" loopMergeBlock-" + headerBlock);
                document.getElementById("label-" + continueBlock).className += (" loopContinueBlock-" + headerBlock);

                mergeBlockResult = instructionMap.get(mergeBlock).result
                for (let key of branchMap.keys()) {
                    if (branchMap.get(key).includes(mergeBlockResult)) {
                        block = instructionMap.get(key).block
                        document.getElementById("label-" + block).className += (" loopBreakBlock-" + headerBlock);
                    }
                }

                break;
            case spirvEnum.Op.OpSelectionMerge:
                var headerBlock = currentInstruction.block;
                var mergeBlock = (instructionMap.get(resultToInstructionMap.get(module[i + 1]))).block;
                document.getElementById("label-" + headerBlock).className += (" selectionHeaderBlock-" + headerBlock);
                document.getElementById("label-" + mergeBlock).className += (" selectionMergeBlock-" + headerBlock);
                break;
            case spirvEnum.Op.OpReturn:
            case spirvEnum.Op.OpReturnValue:
                var block = currentInstruction.block;
                document.getElementById("label-" + block).className += " returnBlock-" + block;
                break;
        }

        // Holds all instructions that have resultID for each operand
        // store now instead of generating at DAG creation time
        // inverse of idConsumers
        var parentInstructions = [];
        var operandIdList = currentInstruction.operandIdList;
        for (let i = 0; i < operandIdList.length; i++) {
            parentInstructions.push(resultToInstructionMap.get(operandIdList[i]));
        }
        currentInstruction.parentInstructions = parentInstructions;

        i += length;
        instructionCount++;
    }

    // Post processing
    // Anything to be done after both passes are made
    {
        // Copy CFG class names from blocks to OpLabel
        var labelDivs = document.getElementsByClassName("label");
        for (let i = 0; i < labelDivs.length; i++) {
            for (let value of labelDivs[i].classList.values()) {
                if (value.startsWith('label') || (value.includes('-') == false)) {
                    continue;
                }

                // Create span to add html text
                var newDiv = document.createElement("span");
                newDiv.setAttribute("class", "blockType");

                var instructionId = value.substring(value.indexOf('-') + 1);
                // String switch case to find all the classes being used
                if (value.startsWith("loopHeaderBlock")) {
                    newDiv.innerHTML = " [Loop Header " + instructionId + "]";
                } else if (value.startsWith("loopMergeBlock")) {
                    newDiv.innerHTML = " [Loop Merge " + instructionId + "]";
                } else if (value.startsWith("loopContinueBlock")) {
                    newDiv.innerHTML = " [Loop Continue " + instructionId + "]";
                } else if (value.startsWith("loopBreakBlock")) {
                    newDiv.innerHTML = " [Loop Break " + instructionId + "]";
                } else if (value.startsWith("selectionHeaderBlock")) {
                    newDiv.innerHTML = " [Selection Header " + instructionId + "]";
                } else if (value.startsWith("selectionMergeBlock")) {
                    newDiv.innerHTML = " [Selection Merge " + instructionId + "]";
                } else if (value.startsWith("returnBlock")) {
                    newDiv.innerHTML = " [Return " + instructionId + "]";
                } else {
                    assert(false, "Unknown label class: " + value);
                }

                newDiv.innerHTML + "<br>"
                labelDivs[i].prepend(newDiv);
            }
        }

        // Apply jquery events
        $(".id").on("click", idOnClick);
        $(".operation").on("click", operationOnClick);
    }

    // Nothing has failed
    const performanceEnd = performance.now();
    console.log("Binary parsed in " + ((performanceEnd - performanceStart) / 1000).toFixed(3) + " seconds");
    return true;
}

// Takes id and creates html string to be displayed
function createIdHtmlString(id, extraClass) {
    return "<a class=\"" + extraClass + " id id" + id + "\">%" + id + "</a>"
}

// Wraps the div with the proper HTML elements
// newDiv param must have been created prior to keep scope
function addCollapsibleWrapper(newDiv, appendDiv, attributeName, type) {
    var input = document.createElement("input");
    input.setAttribute("id", "collapsible_" + attributeName);
    input.setAttribute("class", "toggle");
    input.setAttribute("type", "checkbox");
    input.setAttribute("checked", "");
    input.style.display = "none"; // hide checkbox

    var label = document.createElement("label");
    label.setAttribute("for", "collapsible_" + attributeName);
    label.setAttribute("class", "label-toggle label-" + type);
    if (type == "preFunction") {
        label.innerHTML = "Pre-Function";
    } else if (type == "function") {
        label.innerHTML = "Function " + attributeName;
    } else {
        label.innerHTML = "Label " + attributeName;
    }

    var wrapDiv = document.createElement("div");
    wrapDiv.setAttribute("class", "collapsible-content");
    newDiv.setAttribute("id", type + "-" + attributeName);
    newDiv.setAttribute("class", type);

    wrapDiv.appendChild(newDiv);
    appendDiv.appendChild(input);
    appendDiv.appendChild(label);
    appendDiv.appendChild(wrapDiv);
}

function uncollapseInstruction(instructionDiv) {
    var labelDiv = instructionDiv.parentNode.parentNode.previousSibling;
    var inputDiv = labelDiv.previousSibling;
    inputDiv.checked = true;
    if (labelDiv.classList.contains("label-label") == true) {
        // Labels need to uncollapse the function they are in as well
        var functionLabelDiv = instructionDiv.parentNode.parentNode.parentNode.parentNode.previousElementSibling.previousElementSibling;
        functionLabelDiv.checked = true; // uncollapses
    }
}

// Holds the current dag data used by d3
var liveDagData = [];

const instructionHighlightOff = "#ffffff"; // default state
const instructionHighlightOn = "#c9cdff"; // when in use in dag
const instructionHighlightHover = "#9595ff"; // when in use and hovered

function clearDagData() {
    for (let i = 0; i < liveDagData.length; i++) {
        var instructionFn = $("#instruction_" + liveDagData[i].id);
        var instructionDiv = instructionFn[0];

        // on switching files these dives are already gone
        if (instructionDiv) {
            // set background back to default
            instructionDiv.style.backgroundColor = instructionHighlightOff;

            // remove event listeners
            instructionFn.off("mouseover", instructionHover);
            instructionFn.off("mouseout", instructionHover);
        }
    }
    liveDagData = [];
}

// @param instruction Which instruction in the module
// @param parents The parent nodes of the current instruction
function fillDagData(instruction, parents) {
    // ignore if already in liveDagData
    // TODO this is poor search, but should not be a bottleneck for now
    for (let i = 0; i < liveDagData.length; i++) {
        if (liveDagData[i].id == instruction) {
            return;
        }
    }

    var instructionFn = $("#instruction_" + instruction);
    var instructionDiv = instructionFn[0];
    // set background color for each instruction in liveDagData
    // #c9cdff is "dark lavender"
    instructionDiv.style.backgroundColor = instructionHighlightOn;

    // Add event listener to map to the graph
    instructionFn.on("mouseover", instructionHover);
    instructionFn.on("mouseout", instructionHover);

    var operation = instructionDiv.innerText;
    var opcode = instructionDiv.getElementsByClassName("operation")[0].innerText;
    // remove starting instruction prefix and operands suffix
    operation = operation.substring(operation.indexOf(" ")+1, operation.indexOf(opcode) + opcode.length);

    // Add each item in text array to be its own line in dag node
    var text = [operation];

    var resultTypeDiv = instructionDiv.getElementsByClassName("resultType");
    if (resultTypeDiv.length != 0) {
        assert(resultTypeDiv.length == 1, "More then 1 resultType found in " + instruction);
        text.push(resultTypeDiv[0].innerText);
    }

    var operandDivs = instructionDiv.getElementsByClassName("operand");
    for (let i = 0; i < operandDivs.length; i++) {
        text.push(operandDivs[i].innerText);
    }

    liveDagData.push({
        "id": instruction,
        "text" : text,
        "parentIds": parents
    });
}

// @brief Recursive function to fill dag data from all the parentInstructions backwards
// @param instruction Which instruction in the module
// @param operand If set, will only branch into that operand and not all parentIds
function fillDagBackward(instruction, operand) {
    var parents = [];
    if (operand) {
        // only search parent of passed in operand
        parents.push(resultToInstructionMap.get(operand));
    } else {
        // use all parents of instruction
        parents = instructionMap.get(instruction).parentInstructions;
    }

    fillDagData(instruction, parents);
    for (let i = 0; i < parents.length; i++) {
        fillDagBackward(parents[i]);
    }
}

// @param opcode String of opcode to base dag off of
// @param instruction Assumes is already parsed to int
function displayDagOpcode(opcode, instruction) {
    clearDagData();
    fillDagBackward(instruction);
    drawDag(liveDagData);
}

// @param operand Id of operand, assumes is already parsed to int.
//        Will include Result Type as well
// @param instruction Assumes is already parsed to int
function displayDagOperand(operand, instruction) {
    clearDagData();
    fillDagBackward(instruction, operand);
    drawDag(liveDagData);
}

// @param result Id of result, assumes is already parsed to int
// @param instruction Assumes is already parsed to int
function displayDagResult(result, instruction) {
    clearDagData();
    fillDagData(instruction, []);
    // Set 2nd level of graph with all consumers of the reusltID
    var consumers = idConsumers[result];
    for (let i = 0; i < consumers.length; i++) {
        fillDagData(consumers[i], [instruction]);
    }
    drawDag(liveDagData);
}

// @param toggle True to use, False to not
function useOpNames(toggle) {
    // Map contains (42 -> "string")
    opNameMap.forEach(function(value, key, map) {
        // Each HTML element is id="id42"
        var className = "id" + key;
        var newValue = toggle ? ("%" + value) : ("%" + key);
        for (let i = 0; i < document.getElementsByClassName(className).length; i++) {
            document.getElementsByClassName(className)[i].innerText = newValue;
        }
    });
}

// Used to hold a different color for each node
var dagColorMap = {};

// create a tooltip
var tooltipDiv = d3.select("#dagDiv")
    .append("div")
    .style("position", "absolute")
    .style("opacity", 0)
    .attr("class", "tooltip")
    .style("background-color", "white")
    .style("border", "solid")
    .style("border-width", "2px")
    .style("border-radius", "5px")
    .style("padding", "5px");

function tooltipHide() {
    tooltipDiv.style("opacity", 0)
}

function dagNodeOnClick(node) {
    // Snaps to instruction text on click
    var instructionDiv = document.getElementById("instruction_" + node.id);
    uncollapseInstruction(instructionDiv);
    instructionDiv.scrollIntoView({block: "center"});
}

// originalColor is optional param used when toggling off
function dagNodeHighlight(nodeDiv, toggle, originalColor) {
    if (toggle) {
        nodeDiv.select('rect')
            .attr('fill', "white")
            .attr('cursor', "pointer")
            .attr('stroke-width', 3);
        nodeDiv.select('text')
            .attr('fill', "black")
            .attr('cursor', "pointer");
    } else {
        nodeDiv.select('rect')
            .attr('fill', originalColor)
            .attr('stroke-width', 0);
        nodeDiv.select('text')
            .attr('fill', invertedTextColor(originalColor));
    }
}

// Used to "highlight" node when hovering disassembled instructions
function instructionHover(event) {
    var instructionDiv = event.target;
    // use the <div> to know if hoving internal dom element
    if (instructionDiv.tagName != "DIV") {
        instructionDiv = instructionDiv.parentElement;
    }

    var id = instructionDiv.id;
    var instruction = parseInt(id.substring(id.indexOf("_")+1));
    var nodeDiv = d3.select("#node" + instruction);

    if (event.type == "mouseover") {
        instructionDiv.style.backgroundColor = instructionHighlightHover;
        dagNodeHighlight(nodeDiv, true, null);
    } else {
        instructionDiv.style.backgroundColor = instructionHighlightOn;
        dagNodeHighlight(nodeDiv, false, dagColorMap[instruction]);
    }
}

// Used to "highlight" node when hovering dag nodes
function dagNodeOnHover(node) {
    var nodeDiv = d3.select(this);
    dagNodeHighlight(nodeDiv, true, null);

    // Need to ignore the first index of the text since its not an operand
    var operandNames = instructionMap.get(node.data.id).operandNameList;
    assert(operandNames.length >= (node.data.text.length - 1), "operandNames length is somehow larger than text length");

    var tooltipHtml = "";
    // skip result/opcode in text
    for (let i = 1; i < node.data.text.length; i++) {
        tooltipHtml +=  "<span class=\"tooltipKey\">" + operandNames[i - 1] + "</span>";
        tooltipHtml +=  ": ";
        tooltipHtml +=  "<span class=\"tooltipValue\">" + node.data.text[i] + "</span><br>";
    }

    tooltipDiv
        .style("opacity", 1)
        .html(tooltipHtml);

    // highlighting of disassembled instructions
    document.getElementById("instruction_" + node.id).style.backgroundColor = instructionHighlightHover;
}

// Used to update tooltip while hovering over it
function dagNodeOnMove(node) {
    // need small gap to prevent hovering over the tool tip itself
    // also the pointer gets in the way
    tooltipDiv
        .style("left", (event.clientX + 10) + "px")
        .style("top", (event.clientY + 10) + "px");
}

// Restore node original color
function dagNodeOffHover(node) {
    var nodeDiv = d3.select(this);
    dagNodeHighlight(nodeDiv, false, dagColorMap[node.id]);

    tooltipHide();

    // un-highlighting of disassembled instructions
    document.getElementById("instruction_" + node.id).style.backgroundColor = instructionHighlightOn;
}

function drawDag(dagData) {
    // incase tooltip is lingering
    tooltipHide();

    // Grab each time incase window is resized
    const rect = document.getElementById('dagDiv').getBoundingClientRect();

    // Start much larger than the size of the screen and then narrow it down
    // if the DAG doesn't need it all.
    // If start small and go the other way, chance d3 will freeze from not being able
    // to find a way to layout the dag.
    const dagLayoutWidth = rect.width * 5;
    const dagLayoutHeight = rect.height * 5;

    const newLineSize = 17.0; // little padding
    const maxLines = 5;

    const rectHeight = newLineSize * (maxLines + 0.5); // max lines and half a line to pad
    const nodeHeight = rectHeight * 1.3; // 1.0 == no gap, 2.0 == full rect size for gap
    const nodeWidth = 275; // shuold be able to fix everything
    const rectWidth = nodeWidth * .85; // 1.0 == no gap, 0.5 == full rect size for gap

    // Found that sugiyama is nicer to view, but unlike arquint it can't dynamically adjust height
    // Since 99% of instructions are capped at 5 lines, it is easier to make height set to 5 and
    // anything with more than 5 lines can be "..." and show in a tool tip
    const layout = d3.sugiyama()
        .size([dagLayoutWidth, dagLayoutHeight])
        .nodeSize([nodeWidth, nodeHeight])
        .layering(d3.layeringSimplex())
        .decross(d3.decrossTwoLayer().order(d3.twolayerOpt()))
        .coord(d3.coordVert());

    var reader = d3.dagStratify();
    var dag = reader(dagData);
    layout(dag);

    // If the graph is small, need to size up to be fit the full screen
    //     otherwise can be way too smal
    // This also trims down the current large size used to generate DAG
    // 93% gives enough padding to remove the scroll bar
    var svgWidth = rect.width * .93;
    var svgHeight = rect.height * .93;
    dag.each((node, i) => {
        svgWidth = (node.x > svgWidth) ? node.x : svgWidth;
        svgHeight = (node.y > svgHeight) ? node.y : svgHeight;
    });

    // Generate svg
    const dagSvg = d3.select("#dagSvg");

    // clear previous SVG
    dagSvg.selectAll("*").remove();

    // SVG is offet by radius other the middle of node is cut in half at boundary
    dagSvg
        .attr("width", svgWidth)
        .attr("height", svgHeight)
        .attr("viewBox", `${-nodeWidth/2} ${-nodeHeight/2} ${svgWidth + nodeWidth} ${svgHeight + nodeHeight}`);
    const defs = dagSvg.append('defs'); // For gradients

    // Generate unique color for each node
    const steps = dag.size();
    const interp = d3.interpolateRainbow;
    dag.each((node, i) => {
        dagColorMap[node.id] = interp(i / steps);
    });

    // How to draw edges
    const line = d3.line()
        .curve(d3.curveCatmullRom)
        .x(data => data.x)
        .y(data => data.y);

    // Plot edges
    dagSvg.append('g')
        .selectAll('path')
        .data(dag.links())
        .enter()
        .append('path')
        .attr('d', ({ data }) => line(data.points))
        .attr('fill', 'none')
        .attr('stroke-width', 3)
        .attr('stroke', ({source, target}) => {
        const gradId = `${source.id}-${target.id}`;
        const grad = defs.append('linearGradient')
            .attr('id', gradId)
            .attr('gradientUnits', 'userSpaceOnUse')
            .attr('x1', source.x)
            .attr('x2', target.x)
            .attr('y1', source.y)
            .attr('y2', target.y);
        grad.append('stop').attr('offset', '0%').attr('stop-color', dagColorMap[source.id]);
        grad.append('stop').attr('offset', '100%').attr('stop-color', dagColorMap[target.id]);
        return `url(#${gradId})`;
        });

    // Select nodes
    const nodes = dagSvg.append('g')
        .selectAll('g')
        .data(dag.descendants())
        .enter()
        .append('g')
        .attr('transform', ({x, y}) => `translate(${x}, ${y})`)
        .attr('id', node => "node" + node.id)
        .on("click", dagNodeOnClick)
        .on("mousemove", dagNodeOnMove)
        .on("mouseover", dagNodeOnHover)
        .on("mouseout", dagNodeOffHover);

    nodes.append('rect')
        .attr('width', rectWidth)
        .attr('height', rectHeight)
        .attr('x', -(rectWidth/2))
        .attr('y', -(rectHeight/2))
        .attr('fill', node => dagColorMap[node.id])
        .attr('stroke', "black");

        // Add text to nodes
    nodes.append('text')
        .attr('font-weight', 'bold')
        .attr('text-anchor', 'middle')
        .attr('y', -(rectHeight/2)) // puts text aligned with top of rect
        .attr('fill', node => invertedTextColor(dagColorMap[node.id]))
        .selectAll('tspan')
        .data(function(data) {
            // Grab extra line to know if there is a N+1 line
            return data.data.text.slice(0, maxLines + 1);
        })
        .enter()
        .append('tspan')
        .text(function(data, i, array) {
            if (i >= maxLines) {
                // empty tspan
                return "";
            } else if ((i == maxLines - 1) && (array.length > maxLines)) {
                // If there are more than max lines, mark the last line (zero indexed)
                return "...";
            } else {
                return data;
            }
        })
        .attr('x', "0")
        .attr('dy', function() {
            return newLineSize;
        });
}