// Copyright (c) 2023 The Khronos Group Inc.
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

/*
This takes a string and turns it into a Uint32Array SPIR-V binary

Details of the layout of a SPIR-V Instruction can be found at
https://registry.khronos.org/SPIR-V/specs/unified1/SPIRV.html#_physical_layout_of_a_spir_v_module_and_instruction
*/
function assemble(spirvText, version) {
    let encoder = new TextEncoder();

    let idMap = new Map();             // map text name to binary ID used [ %stringName, %1 ]
    let bitWidthIntMap = new Map();    // map [ %stringName, width ] for OpConstants
    let bitWidthFloatMap = new Map();  // map [ %stringName, width ] for OpConstants

    let lastOpExtInst = 0;

    // SPIR-V Header
    let words = [
        spirv.Meta.MagicNumber, (version == undefined) ? SPV_ENV_UNIVERSAL_1_0 : version,
        0x0,  // generator
        0x0,  // ID Bounds - update later
        0x0,  // reserved
    ];

    // first ID in SPIR-V is %1 (not %0)
    let idsBound = 1;

    // Make life easy, assume every instruction is a single line
    spirvText.split('\n').forEach(line => {
        // If there is a Literal String, capture it to use later
        let literalString = undefined;
        const quoteStart = line.indexOf('"')
        let extraWords = 0;
        if (quoteStart != -1) {
            const quoteEnd = line.lastIndexOf('"');
            literalString = line.substring(quoteStart + 1, quoteEnd) + '\0';
            // Substract 1 because there is already 1 word accounted for the string in line
            extraWords = Math.ceil(literalString.length / 4) - 1;
            // Just need to replace whitespaces here so the split() works as intended
            line.replace(literalString, '/\s+/g, \'\'');
        }

        // regex to remove all duplicated white space
        // This makes the 'line' be an array of all words\
        line = line.trim().replace(/\s{2,}/g, ' ').split(' ');
        if (line.length == 1 && line[0] == '') {
            return;
        }  // empty line
        if (line[0] == ';') {
            return;
        }  // SPIR-V comment

        const hasResult = line.length >= 3 && line[1] == '=';
        if (hasResult) {
            if (idMap.get(line[0]) == undefined) {
                idMap.set(line[0], idsBound++);
            }
        }

        const instructionLength = (hasResult ? line.length - 1 : line.length) + extraWords;

        const opname = hasResult ? line[2] : line[0];
        const opcode = spirv.NameToOpcode.get(opname);
        words.push((instructionLength << spirv.Meta.WordCountShift) | (opcode));

        let operandIndex = 0;  // Which binary operand at
        let lineIndex = 1;     // Which text word at (default if not Type/Result)

        // When looping operands, can use to easily stop parsing for Wildcard that have zero entries
        const lastWord = (words.length - 1) + instructionLength;

        const hasResultType = spirv.OpcodesWithResultType.includes(opcode);
        if (hasResultType) {
            operandIndex++;
            lineIndex++;
            const resultType = hasResult ? line[3] : line[1];
            words.push(idMap.get(resultType));
        }

        if (hasResult) {
            operandIndex++;
            lineIndex += 2;
            words.push(idMap.get(line[0]));
        }

        // Special instructions need to track
        if (opname == 'OpExtInstImport') {
            spirv.setResultToExtImportMap(line[3], idMap.get(line[0]));
        } else if (opname == 'OpExtInst') {
            lastOpExtInst = idMap.get(line[4]);
        } else if (opname == 'OpTypeInt') {
            bitWidthIntMap.set(idMap.get(line[0]), line[3]);
        } else if (opname == 'OpTypeFloat') {
            bitWidthFloatMap.set(idMap.get(line[0]), line[3]);
        }

        // Some operands need to call a few levels of recursion if they have parameters
        function GetOperand(kind) {
            if (kind == 'IdRef' || kind == 'IdScope' || kind == 'IdMemorySemantics') {
                // Just need the <ID> being used
                let id = idMap.get(line[lineIndex]);
                if (id == undefined) {
                    // Mode Setting / Debug / Annotations
                    // instructions will not know what id value is given yet
                    words.push(idsBound);
                    idMap.set(line[lineIndex], idsBound++);
                } else {
                    words.push(id);
                }
                lineIndex++
            } else if (kind == 'LiteralExtInstInteger') {
                const extInstructionSet = spirv.getExtInstructions(lastOpExtInst);
                if (extInstructionSet == undefined) {
                    // There can be custom extended instructions starting with SPIR-V 1.6
                    words.push(parseInt(line[lineIndex++]));
                    return;
                }

                for (let [extOpcode, extInstruction] of extInstructionSet) {
                    if (extInstruction.opname == line[lineIndex]) {
                        lineIndex++
                        words.push(extOpcode);
                        if (extInstruction.operands) {
                            for (let i = 0; i < extInstruction.operands.length; i++) {
                                const extKind = extInstruction.operands[i].kind;
                                GetOperand(extKind);
                            }
                        }
                        return;
                    }
                }
                // If not found, likely the value is just the literal, not a string
                words.push(parseInt(line[lineIndex++]));

            } else if (kind == 'LiteralInteger') {
                words.push(parseInt(line[lineIndex++]));
            } else if (kind == 'LiteralSpecConstantOpInteger') {
                const specOpcode = spirv.NameToOpcode.get('Op' + line[lineIndex++])
                words.push(specOpcode);

                const specInstruction = spirv.Instructions.get(specOpcode);
                // Don't need result or result type
                for (let i = 2; i < specInstruction.operands.length; i++) {
                    const specKind = specInstruction.operands[i].kind;
                    GetOperand(specKind);
                }
            } else if (kind == 'LiteralContextDependentNumber') {
                const typeId = idMap.get(line[lineIndex - 1])
                const bitWidthInt = parseInt(bitWidthIntMap.get(typeId));
                const bitWidthFloat = parseInt(bitWidthFloatMap.get(typeId));
                if (bitWidthInt == 64) {
                    const value = BigInt(line[lineIndex++]);
                    words.push(parseInt(value & BigInt(0xffffffff)));
                    words.push(parseInt(value >> BigInt(32)));
                } else if (bitWidthFloat == 32) {
                    let view = new DataView(new ArrayBuffer(4));
                    view.setFloat32(0, line[lineIndex++]);
                    words.push(view.getUint32(0));
                } else if (bitWidthFloat == 64) {
                    let view = new DataView(new ArrayBuffer(8));
                    view.setFloat64(0, line[lineIndex++]);
                    words.push(view.getUint32(4));
                    words.push(view.getUint32(0));
                } else {
                    words.push(Number(line[lineIndex++]));
                }

                // TODO - Need a better way to do this
                // Go back and update length of instruction
                if (bitWidthInt == 64 || bitWidthFloat == 64) {
                    let instruction = words[words.length - 5];
                    words[words.length - 5] = (((instruction >> 16) + 1) << 16) | (instruction & 0xffff);
                }
            } else if (kind == 'PairLiteralIntegerIdRef') {
                words.push(parseInt(line[lineIndex++]));
                words.push(idMap.get(line[lineIndex++]));
            } else if (kind == 'PairIdRefLiteralInteger') {
                words.push(idMap.get(line[lineIndex++]));
                words.push(parseInt(line[lineIndex++]));
            } else if (kind == 'PairIdRefIdRef') {
                words.push(idMap.get(line[lineIndex++]));
                words.push(idMap.get(line[lineIndex++]));
            } else if (kind == 'LiteralString') {
                let bytes = encoder.encode(literalString);
                // turn Uint8Array to Uint32Array
                for (let i = 0; i < bytes.length; i += 4) {
                    // Can OOB array index because OR operations with 'undefined' is same as OR with zero
                    const word = bytes[i + 3] << 24 | bytes[i + 2] << 16 | bytes[i + 1] << 8 | bytes[i + 0];
                    words.push(word);
                }
            } else {
                const operandInfo = spirv.Operands.get(kind);
                if (!operandInfo.enumerants) {
                    console.log('ERROR: Unhandled kind of ' + kind);
                }

                // If not BitEnum, it is a ValueEnum
                const isBitEnum = (operandInfo.category == 'BitEnum');
                const value = isBitEnum ? line[lineIndex].split('|') : line[lineIndex];
                // If BitEnum, need to update value later on
                const enumValueIndex = words.length;
                words.push(0);  // placeholder
                lineIndex++;

                for (let i = 0; i < operandInfo.enumerants.length; i++) {
                    const enumerant = operandInfo.enumerants[i];
                    if (isBitEnum && value.includes(enumerant.enumerant)) {
                        words[enumValueIndex] |= parseInt(enumerant.value);
                    } else if (!isBitEnum && value == enumerant.enumerant) {
                        words[enumValueIndex] = enumerant.value;
                    } else {
                        continue;
                    }

                    if (enumerant.parameters) {
                        for (let j = 0; j < enumerant.parameters.length; j++) {
                            const parameterKind = enumerant.parameters[j].kind;
                            GetOperand(parameterKind);
                        }
                    }
                }
            }
        }

        const instructionInfo = spirv.Instructions.get(opcode);
        if (instructionInfo.operands == undefined) {
            return;  // things like OpFunctionEnd
        }

        // Need to go through each operand
        let isWildcard = false;
        let kind = '';
        while (operandIndex < instructionInfo.operands.length && (words.length < lastWord)) {
            const operand = instructionInfo.operands[operandIndex];
            kind = operand.kind;
            isWildcard = operand.quantifier == '*';
            GetOperand(kind);
            operandIndex++
        }

        // If at end with wildcard, need to just reuse the same 'kind' for rest of line
        while (isWildcard && (words.length < lastWord)) {
            GetOperand(kind);
            operandIndex++
        }
    });

    // update the header
    words[3] = idsBound;

    return new Uint32Array(words);
}
