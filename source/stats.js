// Copyright (c) 2026 The Khronos Group Inc.
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

//
// The Stats button: a summary of the module shown in the right pane instead of the dag
//
// Everything is computed from the tables parseBinaryStream() fills (instructionMap, idConsumers, ...) and the
// module words, in one pass over the instructions, so it is quick even on the largest modules.
//

const statsDiv = document.getElementById('statsDiv');

// How many of the most used ids to list
const statsMostUsedIds = 10;

// Name of an enum value ("Uniform" for StorageClass 2). The grammar has name -> value, so invert each enum once
var statsEnumInverse = new Map();
function statsEnumName(enumName, value) {
    let inverse = statsEnumInverse.get(enumName);
    if (inverse == undefined) {
        inverse = new Map();
        for (const [key, enumValue] of Object.entries(spirv.Enums[enumName] || {})) {
            inverse.set(enumValue, key);
        }
        statsEnumInverse.set(enumName, inverse);
    }
    const name = inverse.get(value);
    return (name != undefined) ? name : (enumName + ' ' + value);
}

function statsCount(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
}

// Display name of an id: %name when it has an OpName, %N otherwise
function statsIdName(id) {
    return opNameMap.has(id) ? '%' + opNameMap.get(id) : '%' + id;
}

// Short description of a type id ("Struct %Foo", "RuntimeArray of Image"). Typed pointers describe what they point to
function statsTypeName(typeId) {
    const index = resultToInstructionMap.get(typeId);
    if (index == undefined) {
        return '%' + typeId;
    }
    const instruction = instructionMap.get(index);
    const Op = spirv.Enums.Op;
    if (instruction.opcode == Op.OpTypePointer) {
        return statsTypeName(moduleWords[instruction.moduleOffset + 3]);
    }
    const opname = spirv.OpcodeToName[instruction.opcode] || 'Unknown';
    let name = opname.startsWith('OpType') ? opname.substring('OpType'.length) : opname;
    if (instruction.opcode == Op.OpTypeArray || instruction.opcode == Op.OpTypeRuntimeArray) {
        name += ' of ' + statsTypeName(moduleWords[instruction.moduleOffset + 2]);
    }
    if (opNameMap.has(typeId)) {
        name += ' %' + opNameMap.get(typeId);
    }
    return name;
}

// Decorations whose single literal is worth showing in the variable table
const statsVariableDecorations = ['DescriptorSet', 'Binding', 'Location', 'BuiltIn', 'InputAttachmentIndex'];

function computeStats() {
    const words = moduleWords;
    const stats = {
        'bytes': words.length * 4,
        'instructions': instructionMap.size,
        // OpExtInst is counted as "<set name> <instruction>" so the extended instructions sit in the same list
        'opcodeCounts': new Map(),
        'storageClassCounts': new Map(),
        'functions': [],  // {index, id, instructions, blocks, loops, selections, switches, calls}
        'calledCounts': new Map(),  // function id -> number of OpFunctionCall to it
        'entryPointModels': new Map(),  // function id -> [execution model]
        'blocks': 0,
        'loops': 0,
        'selections': 0,
        'switches': 0,
        'largestBlock': {'index': -1, 'instructions': 0},
        // module scope variables: {index, id, storageClass, typeId, untyped, dataTypeId, decorations: Map}
        'variables': [],
    };
    const Op = spirv.Enums.Op;
    const extSetNames = new Map();  // set id -> name
    const decorations = new Map();  // id -> Map(decoration name -> literal text)
    let currentFunction = undefined;
    let currentBlock = undefined;

    for (const [index, instruction] of instructionMap) {
        const offset = instruction.moduleOffset;
        const length = words[offset] >>> 16;
        const opcode = instruction.opcode;

        switch (opcode) {
            case Op.OpExtInstImport:
                extSetNames.set(words[offset + 1], spirv.getLiteralString(words.slice(offset + 2, offset + length)));
                break;
            case Op.OpEntryPoint: {
                const models = stats.entryPointModels.get(words[offset + 2]) || [];
                models.push(statsEnumName('ExecutionModel', words[offset + 1]));
                stats.entryPointModels.set(words[offset + 2], models);
                break;
            }
            case Op.OpDecorate:
            case Op.OpDecorateId:
            case Op.OpDecorateString: {
                const name = statsEnumName('Decoration', words[offset + 2]);
                if (statsVariableDecorations.includes(name) && length > 3) {
                    const literal = (name == 'BuiltIn') ? statsEnumName('BuiltIn', words[offset + 3]) : String(words[offset + 3]);
                    const target = decorations.get(words[offset + 1]) || new Map();
                    target.set(name, literal);
                    decorations.set(words[offset + 1], target);
                }
                break;
            }
            // OpUntypedVariableKHR (SPV_KHR_untyped_pointers) starts with the same operands as OpVariable, but its
            // result type is an untyped pointer and what it holds is an optional "Data Type" operand after the
            // storage class. Some have no data type at all, for example a descriptor heap (SPV_EXT_descriptor_heap)
            case Op.OpVariable:
            case Op.OpUntypedVariableKHR: {
                const storageClass = statsEnumName('StorageClass', words[offset + 3]);
                statsCount(stats.storageClassCounts, storageClass);
                if (currentFunction == undefined) {
                    const untyped = opcode == Op.OpUntypedVariableKHR;
                    stats.variables.push({
                        'index': index,
                        'id': words[offset + 2],
                        'storageClass': storageClass,
                        'typeId': words[offset + 1],
                        'untyped': untyped,
                        'dataTypeId': (untyped && length > 4) ? words[offset + 4] : undefined
                    });
                }
                break;
            }
            case Op.OpFunction:
                currentFunction = {'index': index, 'id': words[offset + 2], 'instructions': 0, 'blocks': 0, 'loops': 0, 'selections': 0, 'switches': 0, 'calls': 0};
                stats.functions.push(currentFunction);
                break;
            case Op.OpLabel:
                stats.blocks++;
                currentBlock = {'index': index, 'instructions': 0};
                if (currentFunction) currentFunction.blocks++;
                break;
            case Op.OpLoopMerge:
                stats.loops++;
                if (currentFunction) currentFunction.loops++;
                break;
            case Op.OpSelectionMerge:
                stats.selections++;
                if (currentFunction) currentFunction.selections++;
                break;
            case Op.OpSwitch:
                stats.switches++;
                if (currentFunction) currentFunction.switches++;
                break;
            case Op.OpFunctionCall:
                statsCount(stats.calledCounts, words[offset + 3]);
                if (currentFunction) currentFunction.calls++;
                break;
        }

        if (opcode == Op.OpExtInst || opcode == Op.OpExtInstWithForwardRefsKHR) {
            const setId = words[offset + 3];
            const extInstructions = spirv.getExtInstructions(setId);
            const extInfo = extInstructions ? extInstructions.get(words[offset + 4]) : undefined;
            const setName = extSetNames.has(setId) ? extSetNames.get(setId) : '%' + setId;
            statsCount(stats.opcodeCounts, setName + ' ' + (extInfo ? extInfo.opname : words[offset + 4]));
        } else {
            statsCount(stats.opcodeCounts, spirv.OpcodeToName[opcode] || ('Opcode ' + opcode));
        }

        // Same numbers as the section bars: a block is its OpLabel up to the next OpLabel or OpFunctionEnd
        if (currentFunction) {
            currentFunction.instructions++;
        }
        if (opcode == Op.OpFunctionEnd) {
            currentFunction = undefined;
            currentBlock = undefined;
        }
        if (currentBlock) {
            currentBlock.instructions++;
            if (currentBlock.instructions > stats.largestBlock.instructions) {
                stats.largestBlock = currentBlock;
            }
        }
    }

    for (const variable of stats.variables) {
        variable.decorations = decorations.get(variable.id) || new Map();
    }
    return stats;
}

// ---- Rendering ----

// Link to an instruction in the disassembly
function statsLink(index, text) {
    return `<a class="statsLink" data-instruction="${index}">${escapeHtml(text)}</a>`;
}

function statsIdLink(id) {
    const index = resultToInstructionMap.get(id);
    const text = statsIdName(id);
    return (index != undefined) ? statsLink(index, text) : escapeHtml(text);
}

function statsHeading(title) {
    return `<h3>${title}</h3>`;
}

// Two column table of label / value
function statsKeyValues(rows) {
    let html = '<table class="statsTable">';
    for (const [key, value] of rows) {
        html += `<tr><td class="statsKey">${key}</td><td>${value}</td></tr>`;
    }
    return html + '</table>';
}

// Counts sorted high to low with a bar relative to the largest
function statsHistogram(counts) {
    if (counts.size == 0) {
        return '<div class="statsNote">none</div>';
    }
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const max = rows[0][1];
    let html = '<table class="statsTable">';
    for (const [key, count] of rows) {
        const width = Math.max(1, Math.round(100 * count / max));
        html += `<tr><td>${escapeHtml(String(key))}</td><td class="statsNum">${count}</td>` +
            `<td class="statsBarCell"><span class="statsBar" style="width: ${width}px"></span></td></tr>`;
    }
    return html + '</table>';
}

function statsTable(headers, rows) {
    if (rows.length == 0) {
        return '<div class="statsNote">none</div>';
    }
    let html = '<table class="statsTable"><tr>';
    for (const header of headers) {
        html += `<th>${header}</th>`;
    }
    html += '</tr>';
    for (const row of rows) {
        html += '<tr>';
        for (const cell of row) {
            html += (typeof cell == 'number') ? `<td class="statsNum">${cell}</td>` : `<td>${cell}</td>`;
        }
        html += '</tr>';
    }
    return html + '</table>';
}

// Type column of the variable table
function statsVariableType(variable) {
    if (!variable.untyped) {
        return statsIdLink(variable.typeId) + ' <span class="statsNote">' + escapeHtml(statsTypeName(variable.typeId)) + '</span>';
    }
    if (variable.dataTypeId == undefined) {
        return statsIdLink(variable.typeId) + ' <span class="statsNote">untyped</span>';
    }
    return statsIdLink(variable.dataTypeId) + ' <span class="statsNote">untyped, ' + escapeHtml(statsTypeName(variable.dataTypeId)) + '</span>';
}

function renderStats(stats) {
    let html = '';

    html += statsHeading('Module');
    const largestBlock = stats.largestBlock;
    html += statsKeyValues([
        ['Size', `${stats.bytes.toLocaleString()} bytes, ${(stats.bytes / 4).toLocaleString()} words`],
        ['Instructions', stats.instructions.toLocaleString()],
        ['Functions', stats.functions.length.toLocaleString()],
        ['Blocks', stats.blocks.toLocaleString()],
        ['Loops / selections / switches', `${stats.loops.toLocaleString()} / ${stats.selections.toLocaleString()} / ${stats.switches.toLocaleString()}`],
        ['Largest block', (largestBlock.index < 0) ? '-' :
            `${largestBlock.instructions.toLocaleString()} instructions, ${statsLink(largestBlock.index, 'Label ' + largestBlock.index)}`],
    ]);

    // From NonSemantic.Shader.DebugInfo.100 (shadersource.js), only when the module has it
    if (debugCompilationUnit != undefined || debugEntryPoint != undefined || sourceFiles.size > 0) {
        html += statsHeading('Shader debug info');
        const rows = [];
        if (debugCompilationUnit != undefined) {
            rows.push(['Language', escapeHtml(statsEnumName('SourceLanguage', debugCompilationUnit.language))]);
        }
        if (debugEntryPoint != undefined) {
            rows.push(['Compiler', `<span class="statsWrap">${escapeHtml(debugEntryPoint.compiler || '')}</span>`]);
            rows.push(['Arguments', `<span class="statsWrap">${escapeHtml(debugEntryPoint.arguments || '')}</span>`]);
        }
        if (sourceFiles.size > 0) {
            const names = [...sourceFiles.values()].map(file => escapeHtml(file.name || '?') + (file.text ? '' : ' <span class="statsNote">(no text)</span>'));
            rows.push(['Source files', `${sourceFiles.size}<div class="statsFiles">${names.join('<br>')}</div>`]);
        }
        html += statsKeyValues(rows);
    }

    html += statsHeading('Functions');
    const functionRows = [...stats.functions].sort((a, b) => b.instructions - a.instructions).map(fn => [
        statsLink(fn.index, statsIdName(fn.id)), escapeHtml((stats.entryPointModels.get(fn.id) || []).join(', ')),
        fn.instructions, fn.blocks, fn.loops, fn.selections, fn.switches, fn.calls, stats.calledCounts.get(fn.id) || 0
    ]);
    html += statsTable(['Function', 'Entry point', 'Instructions', 'Blocks', 'Loops', 'Selections', 'Switches', 'Calls', 'Called'], functionRows);

    html += statsHeading('Module scope variables');
    const variableRows = stats.variables.filter(v => v.storageClass != 'Private').map(v => [
        statsLink(v.index, statsIdName(v.id)), escapeHtml(v.storageClass),
        v.decorations.get('DescriptorSet') || '', v.decorations.get('Binding') || '',
        v.decorations.get('Location') || v.decorations.get('InputAttachmentIndex') || '', escapeHtml(v.decorations.get('BuiltIn') || ''),
        statsVariableType(v),
        (idConsumers[v.id] || []).length  // includes OpName, decorations and OpEntryPoint interfaces
    ]);
    const privateCount = stats.variables.length - variableRows.length;
    html += statsTable(['Variable', 'Storage class', 'Set', 'Binding', 'Location', 'BuiltIn', 'Type', 'Uses'], variableRows);
    if (privateCount > 0) {
        html += `<div class="statsNote">${privateCount} Private variables not listed</div>`;
    }

    html += statsHeading('Variables by storage class');
    html += statsHistogram(stats.storageClassCounts);

    html += statsHeading('Most used ids');
    const used = [];
    for (let id = 0; id < idConsumers.length; id++) {
        if (idConsumers[id] && idConsumers[id].length > 0) {
            used.push([id, idConsumers[id].length]);
        }
    }
    used.sort((a, b) => b[1] - a[1]);
    html += statsTable(['Id', 'Defined by', 'Uses'], used.slice(0, statsMostUsedIds).map(([id, uses]) => {
        const index = resultToInstructionMap.get(id);
        const opname = (index != undefined) ? spirv.OpcodeToName[instructionMap.get(index).opcode] : '?';
        return [statsIdLink(id), (index != undefined) ? statsLink(index, `[${index}] ${opname}`) : '', uses];
    }));

    html += statsHeading('Instructions');
    html += statsHistogram(stats.opcodeCounts);

    return html;
}

function showStats() {
    clearDagDiv();
    if (instructionMap.size == 0) {
        statsDiv.innerHTML = '<div class="statsNote">Load a SPIR-V module first</div>';
        return;
    }
    statsDiv.innerHTML = renderStats(computeStats());
}

document.getElementById('statsButton').addEventListener('click', showStats);

statsDiv.addEventListener('click', function(event) {
    const link = event.target.closest('.statsLink');
    if (link) {
        scrollToInstruction(parseInt(link.dataset.instruction));
    }
});
