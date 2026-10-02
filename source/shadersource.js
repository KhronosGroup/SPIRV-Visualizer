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
// Shader debug info: showing the shader source above the instructions it produced ("Show Source" setting), where
// functions are defined, what was inlined from where, variable names, and the compiler that made the module.
//
// The information comes from NonSemantic.Shader.DebugInfo.100 (DebugSource, DebugLine, DebugScope, DebugInlinedAt,
// DebugFunction, DebugFunctionDefinition, DebugLocalVariable, DebugDeclare, DebugCompilationUnit, DebugEntryPoint) or,
// for the source lines only, from the older OpSource (with text) / OpSourceContinued and OpLine.
// DebugLine / OpLine apply to the instructions after them until the next line instruction, DebugNoLine / OpNoLine or
// the end of the block, DebugScope works the same way.
//
// parseBinaryStream() (main.js) calls recordDebugInstruction() for every NonSemantic.Shader.DebugInfo.100 instruction
// and setSourceRange() for OpLine, and puts a source header div (sourceHeaderHtml) in front of every instruction where
// the line range changes. The headers are always in the DOM and shown or hidden with CSS, so the toggle is instant.
//

// OpString id -> text
var sourceStrings = new Map();
// DebugSource result id, or the OpString id of the file for OpSource/OpLine -> {name, text, lines}
var sourceFiles = new Map();
// The DebugSource/OpSource that DebugSourceContinued/OpSourceContinued append to
var lastSourceFile = undefined;
// DebugFunction id -> {name, source, line}
var debugFunctions = new Map();
// DebugInlinedAt id -> {line, scope, inlined}: the code was inlined into |scope| at |line|, |inlined| chains further out
var debugInlinedAts = new Map();
// [{functionId, debugFunction}] from DebugFunctionDefinition, to put the source location on the function bars
var debugFunctionDefinitions = [];
// DebugLocalVariable / DebugGlobalVariable id -> name
var debugVariableNames = new Map();
// From DebugCompilationUnit and DebugEntryPoint, for the Stats page
var debugCompilationUnit = undefined;  // {language}
var debugEntryPoint = undefined;       // {compiler, arguments}
// How many source headers the module got, 0 means the Show Source setting stays disabled
var sourceHeaderCount = 0;

// The line range (DebugLine / OpLine) and scope (DebugScope) that apply to the instructions being parsed. A new object
// per DebugLine/OpLine, so main.js puts a header in front of the first instruction of each range
var sourceRange = undefined;  // {source, start, end}
var sourceScope = undefined;  // {scope, inlinedAt}

// At most this many lines of a range are shown, the rest is summarized
const sourceMaxLines = 8;

function resetShaderSource() {
    sourceStrings = new Map();
    sourceFiles = new Map();
    lastSourceFile = undefined;
    debugFunctions = new Map();
    debugInlinedAts = new Map();
    debugFunctionDefinitions = [];
    debugVariableNames = new Map();
    debugCompilationUnit = undefined;
    debugEntryPoint = undefined;
    sourceHeaderCount = 0;
    sourceRange = undefined;
    sourceScope = undefined;
}

function addSourceString(id, text) {
    sourceStrings.set(id, text);
}

// @param sourceId What DebugLine/OpLine refer to
// @param name File name, may be undefined
// @param text Source text, may be undefined (a DebugSource without text, or one that is continued later)
function addSourceFile(sourceId, name, text) {
    lastSourceFile = {'name': name, 'text': text || '', 'lines': undefined};
    sourceFiles.set(sourceId, lastSourceFile);
}

function addSourceFileContinued(text) {
    if (lastSourceFile != undefined && text != undefined) {
        lastSourceFile.text += text;
        lastSourceFile.lines = undefined;
    }
}

function setSourceRange(sourceId, lineStart, lineEnd) {
    sourceRange = {'source': sourceId, 'start': lineStart, 'end': lineEnd};
}

// Call at the end of a block, line and scope information doesn't carry over
function clearSourceRange() {
    sourceRange = undefined;
    sourceScope = undefined;
}

// Records a NonSemantic.Shader.DebugInfo.100 instruction while parsing
// @param extOpname The instruction name from the grammar
// @param module The module words
// @param i Word offset of the OpExtInst, its operands start at i + 5
// @param length Word count of the OpExtInst
function recordDebugInstruction(extOpname, module, i, length) {
    // Line numbers and other literals are ids of constants defined earlier in the module
    const constant = id => Number(constantValues.get(id));
    const string = id => sourceStrings.get(id);

    switch (extOpname) {
        case 'DebugSource':
            // File, Text (optional)
            addSourceFile(module[i + 2], string(module[i + 5]), (length > 6) ? string(module[i + 6]) : undefined);
            break;
        case 'DebugSourceContinued':
            addSourceFileContinued(string(module[i + 5]));
            break;
        case 'DebugLine':
            // Source, Line Start, Line End, Column Start, Column End
            setSourceRange(module[i + 5], constant(module[i + 6]), constant(module[i + 7]));
            break;
        case 'DebugNoLine':
            sourceRange = undefined;
            break;
        case 'DebugScope':
            // Scope, Inlined At (optional)
            sourceScope = {'scope': module[i + 5], 'inlinedAt': (length > 6) ? module[i + 6] : undefined};
            break;
        case 'DebugNoScope':
            sourceScope = undefined;
            break;
        case 'DebugFunction':
            // Name, Type, Source, Line, Column, Parent, Linkage Name, Flags, Scope Line, Declaration
            debugFunctions.set(module[i + 2], {'name': string(module[i + 5]), 'source': module[i + 7], 'line': constant(module[i + 8])});
            break;
        case 'DebugFunctionDefinition':
            // Function (the DebugFunction), Definition (the OpFunction)
            debugFunctionDefinitions.push({'functionId': module[i + 6], 'debugFunction': module[i + 5]});
            break;
        case 'DebugInlinedAt':
            // Line, Scope, Inlined (optional)
            debugInlinedAts.set(module[i + 2], {'line': constant(module[i + 5]), 'scope': module[i + 6], 'inlined': (length > 7) ? module[i + 7] : undefined});
            break;
        case 'DebugLocalVariable':
            // Name, Type, Source, Line, Column, Parent, Flags, Arg Number
            debugVariableNames.set(module[i + 2], string(module[i + 5]));
            break;
        case 'DebugGlobalVariable':
            // Name, Type, Source, Line, Column, Parent, Linkage Name, Variable, Flags, Static Member Declaration
            debugVariableNames.set(module[i + 2], string(module[i + 5]));
            addDebugVariableName(module[i + 12], string(module[i + 5]));
            break;
        case 'DebugDeclare':
            // Local Variable, Variable (the OpVariable), Expression
            addDebugVariableName(module[i + 6], debugVariableNames.get(module[i + 5]));
            break;
        case 'DebugCompilationUnit':
            // Version, DWARF Version, Source, Language
            debugCompilationUnit = {'language': constant(module[i + 8])};
            break;
        case 'DebugEntryPoint':
            // Entry Point, Compilation Unit, Compiler Signature, Command-line Arguments
            debugEntryPoint = {'compiler': string(module[i + 7]), 'arguments': string(module[i + 8])};
            break;
    }
}

// A module without OpName still has the variable names in its debug info, so "Use OpNames" can use those
function addDebugVariableName(variableId, name) {
    if (name != undefined && name != '' && !opNameMap.has(variableId)) {
        opNameMap.set(variableId, name);
    }
}

// "file.hlsl:42" for a source id and line, or just the line when the file has no name
function sourceLocationText(sourceId, line) {
    const file = sourceFiles.get(sourceId);
    return ((file && file.name) ? file.name : '') + ':' + line;
}

// The name of the function a DebugScope refers to, if it is a function
function scopeFunctionName(scopeId) {
    const debugFunction = debugFunctions.get(scopeId);
    return debugFunction ? debugFunction.name : undefined;
}

// "inlined into Foo at file.hlsl:440, inlined into Bar at file.hlsl:12" for the current scope, '' when not inlined
function inlinedText() {
    let text = '';
    let inlinedAtId = sourceScope ? sourceScope.inlinedAt : undefined;
    for (let depth = 0; inlinedAtId != undefined && depth < 16; depth++) {
        const inlinedAt = debugInlinedAts.get(inlinedAtId);
        if (inlinedAt == undefined) {
            break;
        }
        const name = scopeFunctionName(inlinedAt.scope);
        const debugFunction = debugFunctions.get(inlinedAt.scope);
        text += (text ? ', ' : '') + 'inlined into ' + (name ? name + ' ' : '') + 'at ' +
            sourceLocationText(debugFunction ? debugFunction.source : undefined, inlinedAt.line);
        inlinedAtId = inlinedAt.inlined;
    }
    return text;
}

// The HTML of a source header for the lines [lineStart, lineEnd] of a source, '' if the text isn't in the module
// @param showFileName Put the file name on the header as well
function sourceHeaderHtml(sourceId, lineStart, lineEnd, showFileName) {
    const file = sourceFiles.get(sourceId);
    if (file == undefined || file.text == '') {
        return '';
    }
    if (file.lines == undefined) {
        file.lines = sourceTextLines(file.text);
    }
    // Lines are 1 based, an end before the start means a single line
    const first = Math.max(1, lineStart);
    const last = Math.max(first, lineEnd);
    if (first >= file.lines.length) {
        return '';
    }
    const shownLast = Math.min(last, file.lines.length - 1, first + sourceMaxLines - 1);

    let html = '<div class="sourceLine">';
    if (showFileName && file.name) {
        html += `<div class="sourceFile">${escapeHtml(file.name)}</div>`;
    }
    for (let line = first; line <= shownLast; line++) {
        const text = file.lines[line];
        if (text != undefined) {
            html += `<span class="sourceLineNumber">${line}</span>${escapeHtml(text)}\n`;
        }
    }
    if (shownLast < last) {
        html += `<span class="sourceLineNumber"></span>... ${last - shownLast} more lines\n`;
    }
    const inlined = inlinedText();
    if (inlined != '') {
        html += `<div class="sourceInlined">${escapeHtml(inlined)}</div>`;
    }
    html += '</div>';
    sourceHeaderCount++;
    return html;
}

// Splits source text into an array indexed by line number (index 0 unused).
// "#line N" directives are honored, the line after one is line N: glslang puts a few "// OpModuleProcessed" comment
// lines and "#line 1" in front of the source it embeds, so without this every line would be off by that much
function sourceTextLines(text) {
    const lines = [undefined];
    let number = 1;
    for (const raw of text.split('\n')) {
        const line = raw.replace(/\r$/, '');
        const directive = line.match(/^\s*#\s*line\s+(\d+)/);
        if (directive) {
            number = parseInt(directive[1]);
            continue;
        }
        lines[number++] = line;
    }
    return lines;
}

// Call after parsing: puts "file.hlsl:434" on the bar of every function that has a DebugFunctionDefinition
// (shown with the Show Source setting), and if the function has no OpName, the debug info name
function addFunctionSourceTags() {
    for (const definition of debugFunctionDefinitions) {
        const debugFunction = debugFunctions.get(definition.debugFunction);
        const index = resultToInstructionMap.get(definition.functionId);
        if (debugFunction == undefined || index == undefined) {
            continue;
        }
        const label = document.querySelector(`label[for="collapsible_${index}"]`);
        if (label == null) {
            continue;
        }
        const tag = document.createElement('span');
        tag.className = 'functionSource';
        tag.textContent = sourceLocationText(debugFunction.source, debugFunction.line);
        // Before the instruction count that floats on the right
        label.insertBefore(tag, label.querySelector('.sectionCount'));
        if (!label.querySelector('.functionName') && debugFunction.name) {
            const name = document.createElement('span');
            name.className = 'functionName';
            name.textContent = '%' + debugFunction.name;
            label.insertBefore(name, tag);
        }
    }
}

// Enables the setting when the module has source information, with a tooltip saying why otherwise
function updateShowSourceSetting() {
    const checkbox = document.getElementById('showSource');
    const available = sourceHeaderCount > 0;
    checkbox.disabled = !available;
    document.getElementById('showSourceDiv').title = available ?
        'Show the shader source lines above the instructions they produced' :
        'This shader has no ShaderDebugInfo (NonSemantic.Shader.DebugInfo.100 DebugSource / DebugLine) or OpSource / OpLine ' +
            'with the source text';
    if (!available) {
        checkbox.checked = false;
        displayDiv.classList.remove('showSource');
    }
}

function showSource(toggle) {
    displayDiv.classList.toggle('showSource', toggle);
}
