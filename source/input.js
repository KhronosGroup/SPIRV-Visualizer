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

//
// Handle all DOM interface input interactions
//

// Load in file
function fileSelected(data, filename) {
    toggleDisassemblyInput(false);
    if (filename == undefined) {
        filename = 'unknown';
    }
    document.getElementById('fileSelectName').innerHTML = 'Loaded: <span style="color : navajowhite">' + escapeHtml(filename) + '</span>';

    // Toggle div to be displayed
    // remove the rest as currently not support reloading spir-v without page refresh
    let preLoad = document.getElementById('preLoad');
    let filePrompt = document.getElementById('filePrompt');
    if (preLoad) {
        preLoad.remove();
    }
    if (filePrompt) {
        filePrompt.remove();
    }
    assert(data != undefined, 'Failed to read in file');
    resetSettings();
    parseBinaryStream(data);
}

const fileSelector = document.getElementById('fileSelector');
const fileSelectorTop = document.getElementById('fileSelectorTop');
function fileSelect(event) {
    const file = event.target.files[0];
    if (file == undefined) {
        return;  // dialog was cancelled
    }
    const reader = new FileReader();
    reader.onload = function() {
        fileSelected(reader.result, file.name);
    };
    reader.readAsArrayBuffer(file);
    // Clear the selection so picking the same file again (ex. after recompiling it) fires another change event
    event.target.value = '';
};
fileSelector.addEventListener('change', fileSelect, false);
fileSelectorTop.addEventListener('change', fileSelect, false);

// This is needed or else the browser will try to download files
function dragOverHandler(event) {
    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';  // Explicitly show this is a copy.
}

// Assume single file
function dropHandler(event) {
    // Prevent default behavior (Prevent file from being opened)
    event.preventDefault();
    var file;
    if (event.dataTransfer.items) {
        // DataTransferItemList interface
        assert(event.dataTransfer.items[0].kind === 'file', 'Can only load single files');
        file = event.dataTransfer.items[0].getAsFile();
    } else {
        // DataTransfer interface
        file = event.dataTransfer.files[0];
    }
    const reader = new FileReader();
    reader.onload = function() {
        const filename = (file) ? file.name : undefined;
        fileSelected(reader.result, filename);
    };
    reader.readAsArrayBuffer(file);
}
const dropArea = document.getElementsByTagName('BODY')[0];
dropArea.addEventListener('drop', dropHandler, false);
dropArea.addEventListener('dragover', dragOverHandler, false);

function idOnClick(event) {
    // Returns DOMTokenList of all classes
    let classList = event.target.classList;
    let parent = event.target.parentElement;

    var id = undefined;
    // find "idN" where "N" is the SPIR-V ID value
    // Can't use innerText due to using opName option
    for (let value of classList.values()) {
        // Only "id" followed by digits, not the "id" class or others like "idHover"
        if (/^id\d+$/.test(value)) {
            id = parseInt(value.substring(2));
        }
    }
    assert(isNaN(id) == false, 'id was NaN');

    // id will be of "instruction_x"
    var instruction = parseInt(parent.id.substring(parent.id.indexOf('_') + 1));
    let hasResult = classList.contains('result');

    if (hasResult) {
        displayDagResult(id, instruction);
    } else {
        // Includes Result Types
        displayDagOperand(id, instruction);
    }
}

function operationOnClick(event) {
    var opcode = collapsedText(event.target);
    let parent = event.target.parentElement;
    // id will be of "instruction_x"
    var instruction = parseInt(parent.id.substring(parent.id.indexOf('_') + 1));
    displayDagOpcode(opcode, instruction);
}

function debugStringOnClick(event) {
    let parent = event.target.parentElement;
    // id will be of "instruction_x"
    var instruction = parseInt(parent.id.substring(parent.id.indexOf('_') + 1));
    displayDebugString(instruction);
}

// A single delegated listener instead of one per element
// Large modules have so many elements that binding each one (as was done with jQuery) overflowed the call stack
document.getElementById('disassembleDisplayDiv').addEventListener('click', function(event) {
    const classList = event.target.classList;
    if (classList.contains('id')) {
        idOnClick(event);
    } else if (classList.contains('operation')) {
        operationOnClick(event);
    } else if (classList.contains('debugString')) {
        debugStringOnClick(event);
    }
});

// Hovering an id highlights every place that id appears, like an editor highlighting a symbol.
// Each id element has an "id42" class. Only the elements near the visible part of the display are highlighted:
// an OpTypeFloat can have 20k uses and searching all of a large module takes longer than a frame. Scrolling moves
// the mouse off the id, which clears the highlight, so the rest is never seen.
// (A single generated CSS rule for the hovered id was tried and is slower, any style sheet change restyles everything)
var hoveredId = undefined;
var hoveredIdElements = [];

function clearHoveredId() {
    for (const element of hoveredIdElements) {
        element.classList.remove('idHover');
    }
    hoveredIdElements = [];
    hoveredId = undefined;
}

// input.js loads before main.js, which defines displayDiv, so look the element up here
const hoverDisplayDiv = document.getElementById('disassembleDisplayDiv');

hoverDisplayDiv.addEventListener('mouseover', function(event) {
    const target = event.target;
    if (!target.classList.contains('id')) {
        return;
    }
    const match = target.className.match(/\bid(\d+)\b/);
    if (match == null || match[1] == hoveredId) {
        return;
    }
    clearHoveredId();
    hoveredId = match[1];
    hoveredIdElements = elementsNearView('id' + hoveredId);
    for (const element of hoveredIdElements) {
        element.classList.add('idHover');
    }
});

hoverDisplayDiv.addEventListener('mouseout', function(event) {
    if (event.target.classList.contains('id')) {
        clearHoveredId();
    }
});

// Some settings are easier to reset than have stateful logic of inputs outside this file
function resetSettings() {
    document.getElementById('opNames').checked = false;
    document.getElementById('insertConstants').checked = false;
    resetSearch();
}

function toggleDisassemblyInput(turnOn) {
    if (turnOn) {
        displayDiv.style.display = 'none';
        inputDiv.style.display = 'inline-block';
        resetSections();
        clearHoveredId();
        displayDiv.innerHTML = '';
    } else {
        displayDiv.style.display = 'inline-block';
        inputDiv.style.display = 'none';
        inputDiv.innerHTML = ''
    }
}

// Runs once every script is loaded, input.js is loaded before main.js which defines displayDiv and inputDiv
document.addEventListener('DOMContentLoaded', function() {
    // On start up
    toggleDisassemblyInput(true);

    inputDiv.addEventListener('keypress', function(event) {
        // Prevents shift+enter from starting event
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            const spirvBinary = assemble(inputDiv.value);
            fileSelected(spirvBinary, 'disassembled text')
        }
    });

    // Sends all the settings checkboxes out to handlers
    for (const checkbox of document.querySelectorAll('#settings input[type="checkbox"]')) {
        checkbox.addEventListener('click', settingsCheckboxClick);
    }
});

function settingsCheckboxClick(event) {
    let box = event.target.name;
    let checked = event.target.checked;

    // dispatches each type of option to be handled
    if (box == 'opNames') {
        useOpNames(checked);
    } else if (box == 'insertConstants') {
        insertConstants(checked);
    } else if (box == 'largerText') {
        // Doesn't effect the settings text size
        document.getElementById('moduleData').style.fontSize = (checked) ? 'medium' : 'small';
    }
}

document.getElementById('collapseAll').addEventListener('click', function() {
    let toggle_elements = document.getElementsByClassName('toggle');
    for (let i = 0; i < toggle_elements.length; i++) {
        if (toggle_elements[i].checked) {
            toggle_elements[i].click();
        }
    }
});

document.getElementById('expandAll').addEventListener('click', function() {
    let toggle_elements = document.getElementsByClassName('toggle');
    for (let i = 0; i < toggle_elements.length; i++) {
        if (!toggle_elements[i].checked) {
            toggle_elements[i].click();
        }
    }
});

document.getElementById('clearAll').addEventListener('click', function() {
    toggleDisassemblyInput(true);
    clearDagDiv();
    resetSearch();
});

document.getElementById('copyToClipboard').addEventListener('click', function() {
    // These modifications make it hard to grab spirv that other assemblers will understand
    let opNamesChecked = document.getElementById('opNames').checked;
    let insertConstantsChecked = document.getElementById('insertConstants').checked;
    if (opNamesChecked || insertConstantsChecked) {
        updateIdText(false, false);
    }

    var clipboard = '';
    let instruction_divs = document.getElementsByClassName("instruction");
    for (let i = 0; i < instruction_divs.length; i++) {
        let instruction_div = instruction_divs[i];
        // strip the [123] number from the front
        const instruction_text = collapsedText(instruction_div);
        let offset = instruction_text.indexOf(']') + 3;
        let opcode = (instruction_div.childElementCount > 2) ? collapsedText(instruction_div.children[1]) : '';

        if (debugStringMap.has(i)) {
            clipboard += instruction_text.substr(offset).replace("click to view", "\"" + debugStringMap.get(i) + "\"\n");
        } else if (opcode == 'OpSwitch' || opcode == 'OpPhi' || opcode == 'OpGroupMemberDecorate') {
            // The HTML will look like
            //      <a/> " (Case " <a/> " : " <a/> ")"
            // So can rejoin by collecting all the children
            for (let i = 1; i < instruction_div.childElementCount; i++) {
                if (i != 1) clipboard += ' ';
                clipboard += collapsedText(instruction_div.children[i]);
            }
            clipboard += '\n';
        } else {
            // normal case
            clipboard += instruction_text.substr(offset) + '\n';
        }
    }

    // reset any settings
    if (opNamesChecked || insertConstantsChecked) {
        updateIdText(opNamesChecked, insertConstantsChecked);
    }

    navigator.clipboard.writeText(clipboard);
    document.getElementById('alertBox').innerHTML = "copied to clipborad!";
    document.getElementById('alertBox').style.display = "block";
    setTimeout(function(){ document.getElementById('alertBox').style.display = "none"; }, 1000);
});