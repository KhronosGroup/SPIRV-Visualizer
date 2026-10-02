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

var spirv = {
    // When all the needed JSON grammar files load, let the UI know
    JsonIsReady: false,

    // Common Helper Functions/Utils
    validateHeader: undefined,
    getLiteralString: undefined,

    GrammarPath: '',
    Version: '0.0.0',
    Meta: {},

    Enums: {},                // enum values for opcodes and operands
    Instructions: new Map(),  // details information about opcodes
    Operands: new Map(),      // details information about operands in 'operand_kinds' section

    OpcodeToName: new Map(),  // [ opcode number id : 'OpCode' string ]
    NameToOpcode: new Map(),  // [ 'OpCode' string : opcode number id ]

    ExtInstructions: new Map(),  // Same mapping as Instructions, but for each grammar file
    ExtOperands: new Map(),      // Same mapping as Operands, but for each grammar file
    // To save everyone having to build this map themselve, provide helpers
    ResultToExtImport: new Map(),  // Map result ID of OpExtInstImport to actual
    setResultToExtImportMap: undefined,
    getExtInstructions: undefined,
    getExtOperands: undefined,

    // Non-Semantic instructions don't have literals, so we need to manually map ValueEnum/BitEnum
    // DebugBreak and DebugPrintf don't have any operands that need checking
    getNonSemanticType: undefined,

    OpcodesWithResultType: [],
    OpcodesWithResult: [],
};

const SPV_ENV_UNIVERSAL_1_0 = 0x00_01_00_00;
const SPV_ENV_UNIVERSAL_1_1 = 0x00_01_01_00;
const SPV_ENV_UNIVERSAL_1_2 = 0x00_01_02_00;
const SPV_ENV_UNIVERSAL_1_3 = 0x00_01_03_00;
const SPV_ENV_UNIVERSAL_1_4 = 0x00_01_04_00;
const SPV_ENV_UNIVERSAL_1_5 = 0x00_01_05_00;
const SPV_ENV_UNIVERSAL_1_6 = 0x00_01_06_00;
const SPV_ENV_VULKAN_1_0 = 0x00_01_00_00;
const SPV_ENV_VULKAN_1_1 = 0x00_01_01_00;
const SPV_ENV_VULKAN_1_2 = 0x00_01_03_00;
const SPV_ENV_VULKAN_1_3 = 0x00_01_05_00;

// number of json files needed to be loaded (spirv.json + core grammar + every extended instruction set)
var jsonRefCount = 0;
var jsonRefTotal = 0;  // set in loadSpirv()

function spirvJsonLoaded() {
    jsonRefCount++;

    if (jsonRefCount == jsonRefTotal) {
        spirv.JsonIsReady = true;

        if (TEST_SUITE == true) {
            // Kick off test suite
            runTestSuite();
        } else if (DEBUG == true) {
            // Debug flow to preload a spirv binary
            console.log('DEBUG MODE --- ON');
            var xhr = new XMLHttpRequest();
            xhr.open('GET', DEBUG_FILE, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = function(e) {
                // simulate HTML dom change
                var filename = this.responseURL.replace(/^.*[\\\/]/, '');
                fileSelected(this.response, filename);
            };
            xhr.send();
        } else {
            // Prompt user to select file
            document.getElementById('preLoad').style.display = 'none';
            document.getElementById('filePrompt').style.visibility = 'visible';
            document.getElementById('spirvVersion').innerText = spirv.Version;
        }
    }
}

// TODO When internal SPIR-V spec issue #611 is resolved should not need this
const ExtInstTypeGlslStd450 = 0;
const ExtInstTypeOpenCLStd = 1;
const ExtInstTypeNonSemanitcDebugPrintf = 2;
const ExtInstTypeNonSemanitcClspvReflection = 3;
const ExtInstTypeNonSemanitcDebugInfo = 4;
const ExtInstTypeDebugInfo = 5;
const ExtInstTypeOpenCLDebug100 = 6;
const ExtInstTypeNonSemanitcVkspReflection = 7;
const ExtInstTypeNonSemanitcDebugBreak = 8;
const ExtInstTypeNonSemanitcGraphDebugInfo = 9;
const ExtInstTypeAmdShaderExplicitVertexParameter = 10;
const ExtInstTypeAmdShaderTrinaryMinmax = 11;
const ExtInstTypeAmdGcnShader = 12;
const ExtInstTypeAmdShaderBallot = 13;
const ExtInstTypeTosa = 14;
const ExtInstTypeArmMotionEngine = 15;
const ExtInstTypeArmExperimentalMLOperations = 16;

// How each OpExtInstImport name maps to a grammar file
// Matches the same way as spvExtInstImportTypeGet() in SPIRV-Tools (exact name, or a prefix for versioned names)
const ExtInstSets = [
    {type: ExtInstTypeGlslStd450, name: 'GLSL.std.450', file: 'extinst.glsl.std.450.grammar.json'},
    {type: ExtInstTypeOpenCLStd, name: 'OpenCL.std', file: 'extinst.opencl.std.100.grammar.json'},
    {type: ExtInstTypeDebugInfo, name: 'DebugInfo', file: 'extinst.debuginfo.grammar.json'},
    {type: ExtInstTypeOpenCLDebug100, name: 'OpenCL.DebugInfo.100', file: 'extinst.opencl.debuginfo.100.grammar.json'},
    // Later versions are supersets that share the same instruction numbering, so the newest grammar handles all of them
    {
        type: ExtInstTypeNonSemanitcDebugInfo,
        prefix: 'NonSemantic.Shader.DebugInfo.',
        file: 'extinst.nonsemantic.shader.debuginfo.grammar.json'
    },
    {
        type: ExtInstTypeNonSemanitcGraphDebugInfo,
        prefix: 'NonSemantic.Graph.DebugInfo.',
        file: 'extinst.nonsemantic.graph.debuginfo.grammar.json'
    },
    {
        type: ExtInstTypeNonSemanitcClspvReflection,
        prefix: 'NonSemantic.ClspvReflection.',
        file: 'extinst.nonsemantic.clspvreflection.grammar.json'
    },
    {
        type: ExtInstTypeNonSemanitcVkspReflection,
        prefix: 'NonSemantic.VkspReflection.',
        file: 'extinst.nonsemantic.vkspreflection.grammar.json'
    },
    {type: ExtInstTypeNonSemanitcDebugPrintf, name: 'NonSemantic.DebugPrintf', file: 'extinst.nonsemantic.debugprintf.grammar.json'},
    {type: ExtInstTypeNonSemanitcDebugBreak, name: 'NonSemantic.DebugBreak', file: 'extinst.nonsemantic.debugbreak.grammar.json'},
    {
        type: ExtInstTypeAmdShaderExplicitVertexParameter,
        name: 'SPV_AMD_shader_explicit_vertex_parameter',
        file: 'extinst.spv-amd-shader-explicit-vertex-parameter.grammar.json'
    },
    {
        type: ExtInstTypeAmdShaderTrinaryMinmax,
        name: 'SPV_AMD_shader_trinary_minmax',
        file: 'extinst.spv-amd-shader-trinary-minmax.grammar.json'
    },
    {type: ExtInstTypeAmdGcnShader, name: 'SPV_AMD_gcn_shader', file: 'extinst.spv-amd-gcn-shader.grammar.json'},
    {type: ExtInstTypeAmdShaderBallot, name: 'SPV_AMD_shader_ballot', file: 'extinst.spv-amd-shader-ballot.grammar.json'},
    {type: ExtInstTypeTosa, name: 'TOSA.001000.1', file: 'extinst.tosa.001000.1.grammar.json'},
    {type: ExtInstTypeArmMotionEngine, name: 'Arm.MotionEngine.100', file: 'extinst.arm.motion-engine.100.grammar.json'},
    {
        type: ExtInstTypeArmExperimentalMLOperations,
        prefix: 'Arm.ExperimentalMLOperations.',
        file: 'extinst.arm.experimental-ml-operations.grammar.json'
    },
];

// Call at OpExtInstImport to save mapping, retrieve with getExtInstructions/getExtOperands
spirv.setResultToExtImportMap = function(extendedName, resultId) {
    for (const set of ExtInstSets) {
        if ((set.name && extendedName == set.name) || (set.prefix && extendedName.startsWith(set.prefix))) {
            spirv.ResultToExtImport.set(resultId, set.type);
            return;
        }
    }
    console.log('Warning: Full support for ' + extendedName + ' has not been added. Good chance things might break.');
}
spirv.getExtInstructions = function(setId) {
    const id = spirv.ResultToExtImport.get(setId);
    return spirv.ExtInstructions.get(id);
}

spirv.getExtOperands = function(setId) {
    const id = spirv.ResultToExtImport.get(setId);
    return spirv.ExtOperands.get(id);
}

spirv.getNonSemanticType = function(setId) {
    const id = spirv.ResultToExtImport.get(setId);
    if (id == ExtInstTypeNonSemanitcDebugInfo) {
        return ExtInstTypeNonSemanitcDebugInfo;
    } else if (id == ExtInstTypeNonSemanitcClspvReflection) {
        return ExtInstTypeNonSemanitcClspvReflection;
    } else {
        return undefined;
    }
}

// Fetches and parses a JSON file, calls onLoad(json) or onError(error)
function fetchJson(url, onLoad, onError) {
    fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error(url + ': ' + response.status + ' ' + response.statusText);
            }
            return response.json();
        })
        .then(onLoad, onError || function(error) {
            assert(false, 'Failed to load ' + url + ' (' + error + ')');
        });
}

function loadSpirvJson() {
    // C Header equivalent
    fetchJson(spirv.GrammarPath + 'spirv.json', function(json) {
        spirv.Meta = json.spv.meta;
        for (let i = 0; i < json.spv.enum.length; i++) {
            spirv.Enums[json.spv.enum[i].Name] = json.spv.enum[i].Values;
        }
        spirv.OpcodeToName = Object.fromEntries(
            Object.entries(spirv.Enums.Op).map(([key, value]) => [value, key])
        );
        spirvJsonLoaded();
    });
}

function loadCoreGrammar() {
    fetchJson(spirv.GrammarPath + 'spirv.core.grammar.json', function(json) {
        spirv.Version = json.major_version + "." + json.minor_version + "." + json.revision;
        // put in map as need faster way to lookup then search large array each time
        for (let i = 0; i < json.instructions.length; i++) {
            const opcode = json.instructions[i].opcode;
            spirv.NameToOpcode.set(json.instructions[i].opname, opcode)
            spirv.Instructions.set(opcode, json.instructions[i]);

            if (json.instructions[i].operands) {
                // IdResultType is always first operand listed
                if (json.instructions[i].operands[0].kind == "IdResultType") {
                    spirv.OpcodesWithResultType.push(opcode);
                }

                // IdResult is always first or second operand listed
                const checkOperands = Math.min(json.instructions[i].operands.length, 2);
                for (let j = 0; j < checkOperands; j++) {
                    if (json.instructions[i].operands[j].kind == "IdResult") {
                        spirv.OpcodesWithResult.push(opcode);
                    }
                }
            }
        }

        for (let i = 0; i < json.operand_kinds.length; i++) {
            spirv.Operands.set(json.operand_kinds[i].kind, json.operand_kinds[i]);
        }
        spirvJsonLoaded();
    });
}

// Extended Instruction sets
function loadExtInstImport() {
    for (const set of ExtInstSets) {
        fetchJson(spirv.GrammarPath + set.file, function(json) {
            const instructions = new Map();
            for (let i = 0; i < json.instructions.length; i++) {
                instructions.set(json.instructions[i].opcode, json.instructions[i]);
            }
            spirv.ExtInstructions.set(set.type, instructions);

            if (json.operand_kinds) {
                const operands = new Map();
                for (let i = 0; i < json.operand_kinds.length; i++) {
                    operands.set(json.operand_kinds[i].kind, json.operand_kinds[i]);
                }
                spirv.ExtOperands.set(set.type, operands);
            }
            spirvJsonLoaded();
        }, function() {
            // Don't block the whole page if a SPIRV-Headers version is missing a grammar file
            console.log('Warning: failed to load ' + set.file + ', instructions from that set will be shown as raw numbers');
            spirvJsonLoaded();
        });
    }
}

// Init into Loading SPIR-V grammar files
function loadSpirv(spirvHeaderPath) {
    spirv.GrammarPath = spirvHeaderPath;
    jsonRefTotal = 2 + ExtInstSets.length;
    loadSpirvJson();
    loadCoreGrammar();
    loadExtInstImport();
}

// @param header Uint32Array with 5 elements in it
spirv.validateHeader = function(header) {
    if (header[0] != spirv.Meta.MagicNumber) {
        // Check for "; SPIR-V" or "OpCapability"
        if (header[0] === 0x5053203B || header[0] === 0x6143704F) {
            assert(false, 'Seems you passed in SPIR-V disassembly instead of the binary... you can copy and paste the disassembly on the left side of the screen.');
        } else {
            assert(false, 'Magic Number doesn\'t match, are you sure this is a binary SPIR-V file?');
        }
    }
    assert(header[1] <= spirv.Meta.Version, 'SPIR-V Headers are older than version of module');
    assert(header[4] == 0, 'Only support schema 0 currently');
}

const utf8Decoder = new TextDecoder('utf-8');

// Literal strings are UTF-8 octets, packed 4 per word starting with the lowest-order byte, and null terminated
// @param words Slice of array of words in instruction
spirv.getLiteralString = function(words) {
    const bytes = new Uint8Array(words.length * 4);
    let length = 0;
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        for (let shift = 0; shift < 32; shift += 8) {
            const byte = (word >>> shift) & 0xFF;
            if (byte == 0) {
                return utf8Decoder.decode(bytes.subarray(0, length));
            }
            bytes[length++] = byte;
        }
    }
    // Not null terminated, decode what is there
    return utf8Decoder.decode(bytes.subarray(0, length));
}

// Number of words a literal string takes up, including the word holding the null terminator
// Can't be calculated from the decoded string length as UTF-8 characters can be multiple bytes
// @param words Slice of array of words in instruction
spirv.getLiteralStringWordCount = function(words) {
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (((word & 0xFF) == 0) || ((word & 0xFF00) == 0) || ((word & 0xFF0000) == 0) || ((word & 0xFF000000) == 0)) {
            return i + 1;
        }
    }
    return words.length;
}
