// Copyright (c) 2021-2023 The Khronos Group Inc.
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
'use strict';

// Grab all DOM objects

var displayDiv = document.getElementById('disassembleDisplayDiv');
var inputDiv = document.getElementById('disassembleInputDiv');

// Main map of all items with instruction index as key
var instructionMap = new Map();
// A mapping of the resultID to the instruction index
var resultToInstructionMap = new Map();
// 2D array with key being an ID
//    value is array of all instructions that use it
var idConsumers = [];
// Mapping of all results to an OpName string
var opNameMap = new Map();
// Mapping of instruction index to an debug instruction (ex OpSource) string
var debugStringMap = new Map();
// Mapping of what to display if inserting constant values
var constantValues = new Map();

// Ensures consecutive loads are cleared
function resetTracking() {
    instructionMap = new Map();
    resultToInstructionMap = new Map();
    idConsumers = [];
    opNameMap = new Map();
    debugStringMap = new Map();
    constantValues = new Map();
}

// @param binary ArrayBuffer of spirv module binary file
function parseBinaryStream(binary) {
    const performanceStart = performance.now();

    // Clear div from any previous run
    displayDiv.innerHTML = '';
    // clear previous SVG
    d3.select('#dagSvg').selectAll('*').remove();
    resetTracking();

    // translate to Uint32 array to match each SPIR-V dword
    assert(binary.byteLength % 4 == 0, 'File is not 4 byte (32 bit) aligned, are you sure this is a binary SPIR-V file?');
    const module = new Uint32Array(binary);

    assert(module.length >= 5, 'module less than 5 dwords which is the size of the header');

    spirv.validateHeader(module.slice(0, 5));
    const maxIdBound = module[3];
    for (let i = 0; i < maxIdBound; i++) {
        idConsumers[i] = [];
    }

    var infoDiv = document.createElement('div');
    const version = ((module[1] >> 16) & 0xff).toString() + '.' + ((module[1] >> 8) & 0xff).toString();
    infoDiv.setAttribute('id', 'module-info');
    infoDiv.innerHTML = 'SPIR-V ' + version + ' (Max ID Bound: ' + maxIdBound.toString() + ')';
    displayDiv.appendChild(infoDiv);

    // Basic iterator mechanism, needs to reset each pass
    var instructionCount = 0;

    // internal representation of the module
    // Built up in first pass
    var currentFunction = {'start': 0, 'end': 0};
    var currentBlock = {'start': 0, 'end': 0, 'function': 0};

    // all instructions before first function are by themselves in "preFunciton" which is broken into 4 sections
    // Set preFunction div the same way as a normal function
    var preFunctionDiv = document.createElement('div');
    addCollapsibleWrapper(preFunctionDiv, displayDiv, 'preFunction', 'modeSetting', 'Mode Setting');

    // div hierarchy
    // displayDiv -> function -> label -> instructions
    var currentInstructionDiv = preFunctionDiv;
    var currentFunctionDiv = undefined;

    // How much each basic block will indent by
    var indentStack = [];
    const indentMultipler = 10;  // pixel

    // when to insert rest of preFunction sections
    var insertedDebug = false;
    var insertedAnnotation = false;
    var insertedType = false;

    // Map of where all branch/switches jump too. Value is array of Label IDs
    var branchMap = new Map();

    // There is a 2 pass system through the stream
    //   First pass: Setup all the DOM elements
    //   Second pass: Edit the DOM elements
    // This 2nd pass makes looking ahead in CFG ops much easier

    // First pass
    for (let i = 5; i < module.length;) {
        const instruction = module[i];
        const instructionLength = instruction >> spirv.Meta.WordCountShift;
        const opcode = instruction & spirv.Meta.OpCodeMask;

        // Get type and result according to instruction layout
        const hasResultType = spirv.OpcodesWithResultType.includes(opcode);
        const hasResult = spirv.OpcodesWithResult.includes(opcode);
        const opcodeResultType = hasResultType ? module[i + 1] : undefined;
        const opcodeResult = hasResult ? (hasResultType ? module[i + 2] : module[i + 1]) : undefined;
        var instructionInfo = spirv.Instructions.get(opcode);
        // Holds operands that are an id (non-literals)
        var operandIdList = [];

        // Find other preFunction opcodes to create more labels
        if (insertedDebug == false && instructionInfo.class == 'Debug') {
            insertedDebug = true;
            let commentDiv = document.createElement('div');
            addCollapsibleWrapper(commentDiv, displayDiv, 'preFunction', 'debug', 'Debug Information');
            currentInstructionDiv = commentDiv;
        } else if (insertedAnnotation == false && instructionInfo.class == 'Annotation') {
            insertedAnnotation = true;
            let commentDiv = document.createElement('div');
            addCollapsibleWrapper(commentDiv, displayDiv, 'preFunction', 'annotations', 'Annotations');
            currentInstructionDiv = commentDiv;
        } else if (insertedType == false && instructionInfo.class == 'Type-Declaration') {
            insertedType = true;
            let commentDiv = document.createElement('div');
            addCollapsibleWrapper(commentDiv, displayDiv, 'preFunction', 'types', 'Types, variables and constants');
            currentInstructionDiv = commentDiv;
        }

        // Handles all aspects related to CFG
        {
            // Manage indent level from nested cfg
            // Need to be done prior to label getting assigned CSS style
            switch (opcode) {
                case spirv.Enums.Op.OpLoopMerge:
                case spirv.Enums.Op.OpSelectionMerge:
                    indentStack.push(module[i + 1]);
                    break;
                case spirv.Enums.Op.OpLabel:
                    if (indentStack[indentStack.length - 1] == module[i + 1]) {
                        indentStack.pop();
                    }
                    break;
            }
            assert(indentStack.length < 1024, 'Control-flow nesting depth limit hit (or infinite loop bug code)')

            // Map the boundaries for functions and blocks
            switch (opcode) {
                case spirv.Enums.Op.OpFunction:
                    currentFunction.start = instructionCount;

                    var newDiv = document.createElement('div');
                    addCollapsibleWrapper(newDiv, displayDiv, 'function', instructionCount, 'Function ' + instructionCount);

                    currentFunctionDiv = newDiv;
                    currentInstructionDiv = newDiv;
                    break;
                case spirv.Enums.Op.OpFunctionEnd:
                    currentFunction.end = instructionCount;

                    // Label has ended and need to add last instruction
                    currentInstructionDiv = currentFunctionDiv
                    break;
                case spirv.Enums.Op.OpLabel:
                    currentBlock.start = instructionCount;
                    currentBlock.function = currentFunction.start;

                    var newDiv = document.createElement('div');

                    assert(currentFunctionDiv, 'OpLabel not in a function block');
                    addCollapsibleWrapper(newDiv, currentFunctionDiv, 'label', instructionCount, 'Label ' + instructionCount);

                    // Set index for both div and the collasible label
                    var indentSize = ((indentStack.length * indentMultipler) + 5);
                    newDiv.style.marginLeft = indentSize + 'px';
                    newDiv.parentNode.previousElementSibling.style.marginLeft = indentSize + 'px';

                    currentInstructionDiv = newDiv;
                    break;
                case spirv.Enums.Op.OpBranch:
                case spirv.Enums.Op.OpBranchConditional:
                case spirv.Enums.Op.OpSwitch:
                case spirv.Enums.Op.OpReturn:
                case spirv.Enums.Op.OpReturnValue:
                case spirv.Enums.Op.OpKill:
                case spirv.Enums.Op.OpUnreachable:
                case spirv.Enums.Op.TerminateInvocation:
                    currentBlock.end = instructionCount;
                    break;
            };

            // Build branching map
            var branchDestinations = [];
            switch (opcode) {
                case spirv.Enums.Op.OpBranch:
                    branchDestinations.push(module[i + 1]);
                    break;
                case spirv.Enums.Op.OpBranchConditional:
                    branchDestinations.push(module[i + 2]);
                    branchDestinations.push(module[i + 3]);
                    break;
                case spirv.Enums.Op.OpSwitch:
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
        if (opcode == spirv.Enums.Op.OpExtInstImport) {
            var extendedName = spirv.getLiteralString(module.slice(i + 2, i + instructionLength));
            spirv.setResultToExtImportMap(extendedName, opcodeResult);
        }

        // Handles all aspect of disassembling the module
        {
            // HTML string to display
            // ex. "[19]  %13 = OpTypeFunction %12"
            var instructionString = '<span class="count">[' + instructionCount + ']</span>&emsp;';

            // Handle the result and type as always will be in front
            if (hasResult == true) {
                instructionString += ' ' + createIdHtmlString(opcodeResult, 'result');
                instructionString += ' = '
                resultToInstructionMap.set(opcodeResult, instructionCount);
            }

            instructionString += ' <a class="operation">' + mapValueToEnumKey(spirv.Enums.Op, opcode) + '</a>'

            if (hasResultType == true) {
                instructionString += ' ' + createIdHtmlString(opcodeResultType, 'resultType');
                idConsumers[opcodeResultType].push(instructionCount);
                operandIdList.push(opcodeResultType);
            }

            // index of array of operands from grammar file array
            var grammarOperandIndex = 0;

            // Where in instruction currently in terms of word
            var operandOffset = 1;  // first dword is not a operand

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

            // When a OpSpecConstantOp is used, the remaining operands are pull from the new instruction
            var specConstantOpInfo = undefined;
            var specConstantOpIndex = 0;

            // These need to be set outside the while loop for optionalArray to just reuse
            // the last type of operand for the rest of the instructions
            var optionalArray = false;
            var operandInfo;

            if (hasResultType == true) {
                operandOffset++;
                grammarOperandIndex++;
                operandNameList.push('Result Type');
            }
            if (hasResult == true) {
                operandOffset++
                grammarOperandIndex++;
            }

            // This loop builds the instruction string using the operands
            // Handles all cases that occur in grammar json files
            while (operandOffset < instructionLength) {
                var operand = module[i + operandOffset];

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
                } else if (specConstantOpInfo) {
                    operandInfo = specConstantOpInfo.operands[specConstantOpIndex];
                    specConstantOpIndex++;
                } else {
                    // Normal
                    operandInfo = instructionInfo.operands[grammarOperandIndex];
                    grammarOperandIndex++;
                }

                // "some" Grammar files stores names as "'name'" and want to remove string quote
                // Fall back to the 'kind' string if no name string
                assert(operandInfo != undefined, 'Unable to find operands from grammar file');
                var operandName;
                if (operandInfo.name) {
                    operandName = (operandInfo.name[0] == '\'') ? operandInfo.name.substring(1, operandInfo.name.length - 1) :
                                                                  operandInfo.name;
                } else {
                    operandName = operandInfo.kind;
                }

                optionalArray = (operandInfo.quantifier == '*');
                var kind = operandInfo.kind;

                if ((kind == 'IdResultType') || (kind == 'IdResult')) {
                    assert(false, 'Should not have to handle IdResultType or IdResult here');
                } else if (kind == 'IdRef') {
                    // handle optional array as speical case for IdRef
                    if (optionalArray) {
                        // some name start listing items instead of being just the name
                        // Example: "'Member 0 type', +\n'member 1 type', +\n..."
                        // but note the first and last char were stripped above
                        var endIndex = operandName.indexOf('\'');
                        if (endIndex != -1) {
                            operandName = operandName.substring(0, endIndex);
                            operandName = operandName.replace(/ [0-9]/g, '');  // remove number if one
                        }
                        // Finish rest of words
                        var quantifierIndex = 0;
                        while (operandOffset < instructionLength) {
                            var nextOperand = module[i + operandOffset]
                            instructionString += ' ' + createIdHtmlString(nextOperand, 'operand');
                            idConsumers[nextOperand].push(instructionCount);
                            operandIdList.push(nextOperand);
                            operandOffset++;

                            operandNameList.push(operandName + ' ' + quantifierIndex);
                            quantifierIndex++;
                        }
                    } else {
                        // if optional (quantifier == "?"), print as normal
                        instructionString += ' ' + createIdHtmlString(operand, 'operand');
                        idConsumers[operand].push(instructionCount);
                        operandIdList.push(operand);
                        operandNameList.push(operandName);
                        operandOffset++;
                    }

                } else if (kind == 'LiteralString') {
                    var literalString = spirv.getLiteralString(module.slice(i + operandOffset, i + instructionLength));
                    // Source strings can be unhelpfully long, so hide by default
                    if (opcode == spirv.Enums.Op.OpSource || opcode == spirv.Enums.Op.OpSourceContinued ||
                        opcode == spirv.Enums.Op.OpModuleProcessed) {
                        debugStringMap.set(instructionCount, literalString);
                        instructionString += ' <span class="operand literal debugString">'
                        instructionString += 'click to view'
                        instructionString += '</span>'
                    } else {
                        instructionString += ' <span class="operand literal">"'
                        instructionString += literalString;
                        instructionString += '"</span>'
                    }
                    operandNameList.push(operandName);
                    // Add 1 for the null terminator
                    operandOffset += Math.ceil((literalString.length + 1) / 4);

                } else if (kind == 'LiteralInteger') {
                    // single word literal
                    instructionString += ' ' + createLiteralHtmlString(operand);
                    operandNameList.push(operandName);
                    operandOffset++;

                } else if (kind == 'LiteralExtInstInteger') {
                    assert(
                        opcode == spirv.Enums.Op.OpExtInst, 'Makes assumption OpExtInst is only opcode with LiteralExtInstInteger');
                    // single word literal but from extended instruction set
                    const setId = module[i + 3];

                    // This will have the while loop use the extended grammar
                    const extInstructionSet = spirv.getExtInstructions(setId);
                    // There can be custom extended instructions starting with SPIR-V 1.6
                    const extOpname = (extInstructionSet == undefined) ? operand : extInstructionSet.get(operand).opname;
                    instructionString += ' ' + createLiteralHtmlString(extOpname);
                    operandNameList.push(operandName);
                    operandOffset++;

                } else if (kind == 'LiteralSpecConstantOpInteger') {
                    specConstantOpInfo = spirv.Instructions.get(module[i + operandOffset]);
                    instructionString += ' ' + createLiteralHtmlString(specConstantOpInfo.opname);
                    operandNameList.push(operandName);
                    operandOffset++;
                    specConstantOpIndex = 0;
                    // Start after results as they inherit from parent instruction
                    specConstantOpIndex += spirv.OpcodesWithResultType.includes(specConstantOpInfo.opcode) ? 1 : 0;
                    specConstantOpIndex += spirv.OpcodesWithResult.includes(specConstantOpInfo.opcode) ? 1 : 0;

                } else if (kind == 'LiteralContextDependentNumber') {
                    // Handle any opcodes that have context dependent operands
                    var width = 1;
                    var operandValue = operand;
                    if (opcode == spirv.Enums.Op.OpConstant || opcode == spirv.Enums.Op.OpSpecConstant) {
                        // Result Type must be a scalar integer type or floating-point type.
                        var contextInstruction = instructionMap.get(resultToInstructionMap.get(module[i + 1]));
                        if (contextInstruction.opcode == spirv.Enums.Op.OpTypeInt) {
                            var signedness = module[contextInstruction.moduleOffset + 3];
                            if (signedness == 1) {
                                // JS way to bring uint32 to int32
                                operandValue = operandValue >> 0;
                            }
                            // 4 instructions is a normal 32 bit width, extra instruction length is another byte
                            width = instructionLength - 3;
                            assert(width <= 2, 'parsing ' + 32 * width + ' bit int is not supported');
                            if (width == 2) {
                                // 64-bit Int
                                // only the high bit are converted to singed
                                var operandValueLow = module[i + 3];
                                var operandValueHigh = (signedness == 1) ? module[i + 4] >> 0 : module[i + 4];
                                // use toString to get rid of suffix from types of BigInt
                                operandValue = ((BigInt(operandValueHigh) << BigInt(32)) + BigInt(operandValueLow)).toString();
                            }
                        } else if (contextInstruction.opcode == spirv.Enums.Op.OpTypeFloat) {
                            // 4 instrutions is a normal 32 bit width, extra instruction length is another byte
                            width = instructionLength - 3;
                            assert(width <= 2, 'parsing ' + 32 * width + ' bit float is not supported');
                            var lowBits = module[i + 3].toString(2);
                            lowBits = new Array(32 - lowBits.length).fill('0').join('') + lowBits;
                            if (width == 2) {
                                // 64-bit Float
                                let highBits = module[i + 4].toString(2);
                                highBits = new Array(32 - highBits.length).fill('0').join('') + highBits;
                                let bits = highBits + lowBits;
                                operandValue = parseFloatString(bits);
                            } else {
                                // 32-bit float
                                operandValue = parseFloatString(lowBits);
                            }
                        } else {
                            assert(false, 'OpConstant/OpSpecConstant result type is not OpTypeInt or OpTypeFloat');
                        }
                    } else {
                        assert(
                            false, 'unknown opcode is using LiteralContextDependentNumber grammar, chance things might break now')
                    }

                    var insertValue = operandValue;
                    if (opcode == spirv.Enums.Op.OpSpecConstant) {
                        insertValue = 'spec(' + insertValue + ')';
                    }
                    constantValues.set(module[i + 2], insertValue);

                    instructionString += ' ' + createLiteralHtmlString(operandValue);
                    operandNameList.push(operandName);
                    operandOffset += width;

                } else if ((kind == 'IdMemorySemantics') || (kind == 'IdScope')) {
                    instructionString += ' ' + createIdHtmlString(operand, 'operand');
                    idConsumers[operand].push(instructionCount);
                    operandIdList.push(operand);
                    operandNameList.push(operandName);
                    operandOffset++;

                } else if (
                    (kind == 'PairLiteralIntegerIdRef') || (kind == 'PairIdRefLiteralInteger') || (kind == 'PairIdRefIdRef')) {
                    // All share the same logic of finshing rest of words 2 operands at a time
                    var quantifierIndex = 0;
                    while (operandOffset < instructionLength) {
                        var nextOperand = module[i + operandOffset];
                        var nextNextOperand = module[i + operandOffset + 1];
                        if (opcode == spirv.Enums.Op.OpSwitch) {
                            instructionString += ' (Case ';
                            instructionString += createLiteralHtmlString(nextOperand);
                            instructionString += ' : ';
                            instructionString += createIdHtmlString(nextNextOperand, 'operand');
                            instructionString += ') ';

                            idConsumers[nextNextOperand].push(instructionCount);
                            operandIdList.push(nextNextOperand);

                            operandNameList.push('Case');
                            operandNameList.push('Id');
                        }
                        if (opcode == spirv.Enums.Op.OpGroupMemberDecorate) {
                            instructionString += ' (';
                            instructionString += createIdHtmlString(nextOperand, 'operand');
                            instructionString += ' : ';
                            instructionString += createLiteralHtmlString(nextNextOperand);
                            instructionString += ') ';

                            idConsumers[nextOperand].push(instructionCount);
                            operandIdList.push(nextOperand);

                            operandNameList.push('Id ' + quantifierIndex);
                            operandNameList.push('Member ' + quantifierIndex);
                        }
                        if (opcode == spirv.Enums.Op.OpPhi) {
                            instructionString += ' (';
                            instructionString += createIdHtmlString(nextOperand, 'operand');
                            instructionString += ' : ';
                            instructionString += createIdHtmlString(nextNextOperand, 'operand');
                            instructionString += ') ';

                            idConsumers[nextOperand].push(instructionCount);
                            idConsumers[nextNextOperand].push(instructionCount);
                            operandIdList.push(nextOperand);
                            operandIdList.push(nextNextOperand);

                            operandNameList.push('Variable ' + quantifierIndex);
                            operandNameList.push('Parent ' + quantifierIndex);
                        }
                        operandOffset += 2;
                        quantifierIndex++;
                    }
                } else {
                    operandInfo = spirv.Operands.get(kind);
                    // If extended instruction might need to check grammar file
                    if (!operandInfo && extendedOperandInfo) {
                        var setId = module[i + 3];
                        operandInfo = spirv.getExtOperands(setId).get(kind);
                    }
                    assert(operandInfo != undefined, 'Unknown grammar \'kind\' of ' + kind);

                    if (operandInfo.enumerants) {
                        var enumerantsLength = operandInfo.enumerants.length;
                        var bitEnumString = '';
                        var foundValue = false;

                        for (let i = 0; i < enumerantsLength; i++) {
                            var value = operandInfo.enumerants[i].value;
                            if (operandInfo.category == 'BitEnum') {
                                value = parseInt(operandInfo.enumerants[i].value, 16);
                                // Will need to test each item if BitEnum
                                // need to catch case where value and operand are both zero
                                if (((value & operand) != 0) || (value == operand)) {
                                    // know at least one value found
                                    if (foundValue == false) {
                                        bitEnumString = operandInfo.enumerants[i].enumerant;
                                    } else {
                                        bitEnumString += ' | ' + operandInfo.enumerants[i].enumerant;
                                    }

                                    if (operandInfo.enumerants[i].parameters) {
                                        parameterOperandQueue.push(operandInfo.enumerants[i].parameters);
                                    }
                                    foundValue = true;
                                }
                            } else if (value == operand) {
                                // Expect a single value, not flags if not BitEnum
                                instructionString +=
                                    ' <span class="operand enumerant">' + operandInfo.enumerants[i].enumerant + '</span>';

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
                            if (operandInfo.category == 'BitEnum') {
                                instructionString += ' <span class="operand enumerant">' + bitEnumString + '</span>';
                            }
                        }
                    }
                }
            }

            // Create instruction div
            var newDiv = document.createElement('div');
            newDiv.innerHTML = instructionString
            newDiv.setAttribute('id', 'instruction_' + instructionCount);
            newDiv.setAttribute('class', 'instruction');
            currentInstructionDiv.appendChild(newDiv);
        }

        // Handles all decorations and names
        if (opcode == spirv.Enums.Op.OpName) {
            var name = spirv.getLiteralString(module.slice(i + 2, i + instructionLength));
            // strings can be empty according to specs definition of Literals
            // to prevent looking like a bug, replace with some more visual
            if (name == '') {
                name = '[empty string]'
            }

            opNameMap.set(module[i + 1], name);
        }

        // Take Constant-Creation class opcodes and save const value to be displayed
        switch (opcode) {
            case spirv.Enums.Op.OpConstantTrue:
                constantValues.set(module[i + 2], 'True');
                break;
            case spirv.Enums.Op.OpConstantFalse:
                constantValues.set(module[i + 2], 'False');
                break;
            case spirv.Enums.Op.OpConstantNull:
                constantValues.set(module[i + 2], 'Null');
                break;
            case spirv.Enums.Op.OpSpecConstantTrue:
                constantValues.set(module[i + 2], 'spec(True)');
                break;
            case spirv.Enums.Op.OpSpecConstantFalse:
                constantValues.set(module[i + 2], 'spec(False)');
                break;
            // value was found already above in LiteralContextDependentNumber check
            case spirv.Enums.Op.OpSpecConstant:
            case spirv.Enums.Op.OpConstant:
            // not supported
            case spirv.Enums.Op.OpConstantComposite:
            case spirv.Enums.Op.OpConstantSampler:
            case spirv.Enums.Op.OpSpecConstantComposite:
            case spirv.Enums.Op.OpSpecConstantOp:
            case spirv.Enums.Op.OpConstantCompositeContinuedINTEL:
            case spirv.Enums.Op.OpSpecConstantCompositeContinuedINTEL:
                break;
        };

        // After parsing instruction insertions/updates
        instructionMap.set(instructionCount, {
            'moduleOffset': i,
            'block': currentBlock.start,
            'function': currentFunction.start,
            'opcode': opcode,
            'result': opcodeResult,
            'resultType': opcodeResultType,
            'operandNameList': operandNameList,
            'operandIdList': operandIdList,
            'parentInstructions': []
        });

        i += instructionLength;
        instructionCount++;
    }

    instructionCount = 0;

    // Second pass
    for (let i = 5; i < module.length;) {
        const instruction = module[i];
        const length = instruction >> spirv.Meta.WordCountShift;
        const opcode = instruction & spirv.Meta.OpCodeMask;

        var currentInstruction = instructionMap.get(instructionCount)

        // Add extra class to blocks for CFG
        switch (opcode) {
            case spirv.Enums.Op.OpLoopMerge:
                var headerBlock = currentInstruction.block;
                var mergeBlock = (instructionMap.get(resultToInstructionMap.get(module[i + 1]))).block;
                var continueBlock = (instructionMap.get(resultToInstructionMap.get(module[i + 2]))).block;
                document.getElementById('label-' + headerBlock).className += (' loopHeaderBlock-' + headerBlock);
                document.getElementById('label-' + mergeBlock).className += (' loopMergeBlock-' + headerBlock);
                document.getElementById('label-' + continueBlock).className += (' loopContinueBlock-' + headerBlock);

                var mergeBlockResult = instructionMap.get(mergeBlock).result
                for (let key of branchMap.keys()) {
                    if (branchMap.get(key).includes(mergeBlockResult)) {
                        block = instructionMap.get(key).block
                        document.getElementById('label-' + block).className += (' loopBreakBlock-' + headerBlock);
                    }
                }

                break;
            case spirv.Enums.Op.OpSelectionMerge:
                var headerBlock = currentInstruction.block;
                var mergeBlock = (instructionMap.get(resultToInstructionMap.get(module[i + 1]))).block;
                document.getElementById('label-' + headerBlock).className += (' selectionHeaderBlock-' + headerBlock);
                document.getElementById('label-' + mergeBlock).className += (' selectionMergeBlock-' + headerBlock);
                break;
            case spirv.Enums.Op.OpReturn:
            case spirv.Enums.Op.OpReturnValue:
                var block = currentInstruction.block;
                document.getElementById('label-' + block).className += ' returnBlock-' + block;
                break;
        }

        // Holds all instructions that have resultID for each operand
        // store now instead of generating at DAG creation time
        // inverse of idConsumers
        let parentInstructions = [];
        const operandIdList = currentInstruction.operandIdList;
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
        var labelDivs = document.getElementsByClassName('label');
        for (let i = 0; i < labelDivs.length; i++) {
            for (let value of labelDivs[i].classList.values()) {
                if (value.startsWith('label') || (value.includes('-') == false)) {
                    continue;
                }

                // Create span to add html text
                var newDiv = document.createElement('span');
                newDiv.setAttribute('class', 'blockType');

                var instructionId = value.substring(value.indexOf('-') + 1);
                // String switch case to find all the classes being used
                if (value.startsWith('loopHeaderBlock')) {
                    newDiv.innerHTML = ' [Loop Header ' + instructionId + ']';
                } else if (value.startsWith('loopMergeBlock')) {
                    newDiv.innerHTML = ' [Loop Merge ' + instructionId + ']';
                } else if (value.startsWith('loopContinueBlock')) {
                    newDiv.innerHTML = ' [Loop Continue ' + instructionId + ']';
                } else if (value.startsWith('loopBreakBlock')) {
                    newDiv.innerHTML = ' [Loop Break ' + instructionId + ']';
                } else if (value.startsWith('selectionHeaderBlock')) {
                    newDiv.innerHTML = ' [Selection Header ' + instructionId + ']';
                } else if (value.startsWith('selectionMergeBlock')) {
                    newDiv.innerHTML = ' [Selection Merge ' + instructionId + ']';
                } else if (value.startsWith('returnBlock')) {
                    newDiv.innerHTML = ' [Return ' + instructionId + ']';
                } else {
                    assert(false, 'Unknown label class: ' + value);
                }

                newDiv.innerHTML + '<br>'
                labelDivs[i].prepend(newDiv);
            }
        }

        // Apply jquery events
        $('.id').on('click', idOnClick);
        $('.operation').on('click', operationOnClick);
        $('.debugString').on('click', debugStringOnClick);
    }

    // Nothing has failed
    const performanceEnd = performance.now();
    document.getElementById('fileSelectName').innerHTML += '<br><span style="font-size : smaller">' +
        'binary parsed in <span style="color : deepskyblue">' + ((performanceEnd - performanceStart) / 1000).toFixed(3) +
        '</span> seconds' +
        '</span>';
    return true;
}

// Takes id and creates html string to be displayed
function createIdHtmlString(id, extraClass) {
    return '<a class="' + extraClass + ' id id' + id + '">%' + id + '</a>'
}

function createLiteralHtmlString(literal) {
    return '<span class="operand literal">' + literal + '</span>';
}

// Wraps the div with the proper HTML elements
// newDiv param must have been created prior to keep scope
function addCollapsibleWrapper(newDiv, appendDiv, type, attributeName, displayName) {
    var input = document.createElement('input');
    input.setAttribute('id', 'collapsible_' + attributeName);
    input.setAttribute('class', 'toggle');
    input.setAttribute('type', 'checkbox');
    input.setAttribute('checked', '');
    input.style.display = 'none';  // hide checkbox

    var label = document.createElement('label');
    label.setAttribute('for', 'collapsible_' + attributeName);
    label.setAttribute('class', 'label-toggle label-' + type);
    label.innerHTML = displayName

    var wrapDiv = document.createElement('div');
    wrapDiv.setAttribute('class', 'collapsible-content');
    newDiv.setAttribute('id', type + '-' + attributeName);
    newDiv.setAttribute('class', type);

    wrapDiv.appendChild(newDiv);
    appendDiv.appendChild(input);
    appendDiv.appendChild(label);
    appendDiv.appendChild(wrapDiv);
}

function uncollapseInstruction(instructionDiv) {
    var labelDiv = instructionDiv.parentNode.parentNode.previousSibling;
    var inputDiv = labelDiv.previousSibling;
    inputDiv.checked = true;
    if (labelDiv.classList.contains('label-label') == true) {
        // Labels need to uncollapse the function they are in as well
        var functionLabelDiv =
            instructionDiv.parentNode.parentNode.parentNode.parentNode.previousElementSibling.previousElementSibling;
        functionLabelDiv.checked = true;  // uncollapses
    }
}

// Holds the current dag data used by d3
var liveDagData = [];

const instructionHighlightOff = '#ffffff';    // default state
const instructionHighlightOn = '#c9cdff';     // when in use in dag
const instructionHighlightHover = '#9595ff';  // when in use and hovered

function clearDagData() {
    // While here, if debug string was used, clear it as well
    document.getElementById('debugStringDiv').innerText = '';

    for (let i = 0; i < liveDagData.length; i++) {
        let instructionFn = $('#instruction_' + liveDagData[i].id);
        let instructionDiv = instructionFn[0];

        // on switching files these dives are already gone
        if (instructionDiv) {
            // set background back to default
            instructionDiv.style.backgroundColor = instructionHighlightOff;

            // remove event listeners
            instructionFn.off('mouseover', instructionHover);
            instructionFn.off('mouseout', instructionHover);
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

    var instructionFn = $('#instruction_' + instruction);
    var instructionDiv = instructionFn[0];
    // set background color for each instruction in liveDagData
    // #c9cdff is "dark lavender"
    instructionDiv.style.backgroundColor = instructionHighlightOn;

    // Add event listener to map to the graph
    instructionFn.on('mouseover', instructionHover);
    instructionFn.on('mouseout', instructionHover);

    var operation = instructionDiv.innerText;
    const opcode = instructionDiv.getElementsByClassName('operation')[0].innerText;
    // remove starting instruction prefix and operands suffix
    operation = operation.substring(operation.indexOf(' ') + 1, operation.indexOf(opcode) + opcode.length);

    // Add each item in text array to be its own line in dag node
    var text = [operation];

    var resultTypeDiv = instructionDiv.getElementsByClassName('resultType');
    if (resultTypeDiv.length != 0) {
        assert(resultTypeDiv.length == 1, 'More then 1 resultType found in ' + instruction);
        text.push(resultTypeDiv[0].innerText);
    }

    var operandDivs = instructionDiv.getElementsByClassName('operand');
    for (let i = 0; i < operandDivs.length; i++) {
        text.push(operandDivs[i].innerText);
    }

    liveDagData.push({'id': instruction, 'text': text, 'parentIds': parents});
}

// There can be cases where a phi loops back to itself such as:
// %add = OpIAdd %int %phi %int_1
// %phi = OpPhi %int %other %p1 %add %p2
// To prevent a "Maximum call stack size exceeded" error, check if already seen node
var seenDagNodesSet;

// @brief Recursive function to fill dag data from all the parentInstructions backwards
// @param instruction Which instruction in the module
// @param operand If set, will only branch into that operand and not all parentIds
// @param entryCall only true when the first call to the function is made
function fillDagBackward(instruction, operand, entryCall) {
    if (entryCall) {
        seenDagNodesSet = new Set();
    }
    if (seenDagNodesSet.has(instruction)) {
        return;  // prevents infinite looping this function
    }
    seenDagNodesSet.add(instruction);

    var parents = [];
    if (operand) {
        // only search parent of passed in operand
        parents.push(resultToInstructionMap.get(operand));
    } else {
        // use all parents of instruction
        parents = instructionMap.get(instruction).parentInstructions;
    }

    // D3 is expecting an array, not a set, but have to make sure no duplicates
    // otherwise it will form dead nodes. This is a central spot to de-dup the array
    //
    // Need to also prevent handing D3 a cycle and removing any node already seen.
    // Doing it here is the easiest spot to do it while building the DAG
    parents = parents.filter(function(element, index) {
        return (parents.indexOf(element) == index) && (!seenDagNodesSet.has(element));
    })

    fillDagData(instruction, parents);
    for (let i = 0; i < parents.length; i++) {
        fillDagBackward(parents[i], undefined, false);
    }
}

// @param opcode String of opcode to base dag off of
// @param instruction Assumes is already parsed to int
function displayDagOpcode(opcode, instruction) {
    clearDagData();
    fillDagBackward(instruction, undefined, true);
    drawDag(liveDagData);
}

// @param operand Id of operand, assumes is already parsed to int.
//        Will include Result Type as well
// @param instruction Assumes is already parsed to int
function displayDagOperand(operand, instruction) {
    clearDagData();
    fillDagBackward(instruction, operand, true);
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

// @param instruction Assumes is already parsed to int
function displayDebugString(instruction) {
    clearDagData();
    d3.select('#dagSvg').selectAll('*').remove();

    let debugStringDiv = document.getElementById('debugStringDiv');
    debugStringDiv.innerText = debugStringMap.get(instruction);
}

// @param toggle True to use, False to not
function useOpNames(toggle) {
    // Map contains (42 -> "string")
    opNameMap.forEach(function(value, key, map) {
        // Each HTML element is id="id42"
        var className = 'id' + key;
        var newValue = toggle ? ('%' + value) : ('%' + key);
        for (let i = 0; i < document.getElementsByClassName(className).length; i++) {
            document.getElementsByClassName(className)[i].innerText = newValue;
        }
    });
}

// @param toggle True to use, False to not
function insertConstants(toggle) {
    // Map contains (42 -> "string")
    constantValues.forEach(function(value, key, map) {
        // Each HTML element is id="id42"
        var className = 'id' + key;
        var newValue = toggle ? value : ('%' + key);
        for (let i = 0; i < document.getElementsByClassName(className).length; i++) {
            var element = document.getElementsByClassName(className)[i];
            // don't replace the result of the constant op itself
            if (element.classList.contains('result')) {
                continue;
            }
            element.innerText = newValue;
            // give unique color from normal ids
            if (toggle) {
                element.classList.add('insertConstant');
            } else {
                element.classList.remove('insertConstant');
            }
        }
    });
}

// Used to hold a different color for each node
var dagColorMap = {};

// create a tooltip
var tooltipDiv = d3.select('#dagDiv')
                     .append('div')
                     .style('position', 'absolute')
                     .style('opacity', 0)
                     .attr('class', 'tooltip')
                     .style('background-color', 'white')
                     .style('border', 'solid')
                     .style('border-width', '2px')
                     .style('border-radius', '5px')
                     .style('padding', '5px');

function tooltipHide() {
    tooltipDiv.style('opacity', 0)
}

function dagNodeOnClick(node) {
    // Snaps to instruction text on click
    var instructionDiv = document.getElementById('instruction_' + node.id);
    uncollapseInstruction(instructionDiv);
    instructionDiv.scrollIntoView({block: 'center'});
}

// originalColor is optional param used when toggling off
function dagNodeHighlight(nodeDiv, toggle, originalColor) {
    if (toggle) {
        nodeDiv.select('rect').attr('fill', 'white').attr('cursor', 'pointer').attr('stroke-width', 3);
        nodeDiv.select('text').attr('fill', 'black').attr('cursor', 'pointer');
    } else {
        nodeDiv.select('rect').attr('fill', originalColor).attr('stroke-width', 0);
        nodeDiv.select('text').attr('fill', invertedTextColor(originalColor));
    }
}

// Used to "highlight" node when hovering disassembled instructions
function instructionHover(event) {
    var instructionDiv = event.target;
    // use the <div> to know if hoving internal dom element
    if (instructionDiv.tagName != 'DIV') {
        instructionDiv = instructionDiv.parentElement;
    }

    var id = instructionDiv.id;
    var instruction = parseInt(id.substring(id.indexOf('_') + 1));
    var nodeDiv = d3.select('#node' + instruction);

    if (event.type == 'mouseover') {
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
    assert(operandNames.length >= (node.data.text.length - 1), 'operandNames length is somehow larger than text length');

    var tooltipHtml = '';
    // skip result/opcode in text
    for (let i = 1; i < node.data.text.length; i++) {
        tooltipHtml += '<span class="tooltipKey">' + operandNames[i - 1] + '</span>';
        tooltipHtml += ': ';
        tooltipHtml += '<span class="tooltipValue">' + node.data.text[i] + '</span><br>';
    }

    tooltipDiv.style('opacity', 1).html(tooltipHtml);

    // highlighting of disassembled instructions
    document.getElementById('instruction_' + node.id).style.backgroundColor = instructionHighlightHover;
}

// Used to update tooltip while hovering over it
function dagNodeOnMove(node) {
    // need small gap to prevent hovering over the tool tip itself
    // also the pointer gets in the way
    tooltipDiv.style('left', (event.clientX + 10) + 'px').style('top', (event.clientY + 10) + 'px');
}

// Restore node original color
function dagNodeOffHover(node) {
    var nodeDiv = d3.select(this);
    dagNodeHighlight(nodeDiv, false, dagColorMap[node.id]);

    tooltipHide();

    // un-highlighting of disassembled instructions
    document.getElementById('instruction_' + node.id).style.backgroundColor = instructionHighlightOn;
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

    const newLineSize = 17.0;  // little padding
    const maxLines = 5;

    const rectHeight = newLineSize * (maxLines + 0.5);  // max lines and half a line to pad
    const nodeHeight = rectHeight * 1.3;                // 1.0 == no gap, 2.0 == full rect size for gap
    const nodeWidth = 275;                              // shuold be able to fix everything
    const rectWidth = nodeWidth * .85;                  // 1.0 == no gap, 0.5 == full rect size for gap

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
    const dagSvg = d3.select('#dagSvg');

    // clear previous SVG
    dagSvg.selectAll('*').remove();

    // SVG is offet by radius other the middle of node is cut in half at boundary
    dagSvg.attr('width', svgWidth)
        .attr('height', svgHeight)
        .attr('viewBox', `${- nodeWidth / 2} ${- nodeHeight / 2} ${svgWidth + nodeWidth} ${svgHeight + nodeHeight}`);
    const defs = dagSvg.append('defs');  // For gradients

    // Generate unique color for each node
    const steps = dag.size();
    const interp = d3.interpolateRainbow;
    dag.each((node, i) => {
        dagColorMap[node.id] = interp(i / steps);
    });

    // How to draw edges
    const line = d3.line().curve(d3.curveCatmullRom).x(data => data.x).y(data => data.y);

    // Plot edges
    dagSvg.append('g')
        .selectAll('path')
        .data(dag.links())
        .enter()
        .append('path')
        .attr('d', ({data}) => line(data.points))
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
                      .attr('id', node => 'node' + node.id)
                      .on('click', dagNodeOnClick)
                      .on('mousemove', dagNodeOnMove)
                      .on('mouseover', dagNodeOnHover)
                      .on('mouseout', dagNodeOffHover);

    nodes.append('rect')
        .attr('width', rectWidth)
        .attr('height', rectHeight)
        .attr('x', -(rectWidth / 2))
        .attr('y', -(rectHeight / 2))
        .attr('fill', node => dagColorMap[node.id])
        .attr('stroke', 'black');

    // Add text to nodes
    nodes.append('text')
        .attr('font-weight', 'bold')
        .attr('text-anchor', 'middle')
        .attr('y', -(rectHeight / 2))  // puts text aligned with top of rect
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
                return '';
            } else if ((i == maxLines - 1) && (array.length > maxLines)) {
                // If there are more than max lines, mark the last line (zero indexed)
                return '...';
            } else {
                return data;
            }
        })
        .attr('x', '0')
        .attr('dy', function() {
            return newLineSize;
        });
}
