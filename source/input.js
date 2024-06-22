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
    document.getElementById('fileSelectName').innerHTML = 'Loaded: <span style="color : navajowhite">' + filename + '</span>';

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
    const reader = new FileReader();
    reader.onload = function() {
        const filename = (event.target.files) ? event.target.files[0].name : undefined;
        fileSelected(reader.result, filename);
    };
    reader.readAsArrayBuffer(event.target.files[0]);
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
        // make sure not to just grab "id" class
        if (value.startsWith('id') && (value.length > 2)) {
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
    var opcode = event.target.innerText;
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

// Some settings are easier to reset than have stateful logic of inputs outside this file
function resetSettings() {
    document.getElementById('opNames').checked = false;
    document.getElementById('insertConstants').checked = false;
}

function toggleDisassemblyInput(turnOn) {
    if (turnOn) {
        displayDiv.style.display = 'none';
        inputDiv.style.display = 'inline-block';
        displayDiv.innerHTML = '';
    } else {
        displayDiv.style.display = 'inline-block';
        inputDiv.style.display = 'none';
        inputDiv.innerHTML = ''
    }
}

// Sends all checkboxes out to handlers
$(document).ready(function() {
    // On start up
    toggleDisassemblyInput(true);

    $('#disassembleInputDiv').on('keypress', function(event) {
        // Prevents shift+enter from starting event
        if (event.which === 13 && !event.shiftKey) {
            event.preventDefault();
            const spirvBinary = assemble(inputDiv.value);
            fileSelected(spirvBinary, 'disassembled text')
        }
    });

    $('input[type="checkbox"]').click(function() {
        let box = $(this)[0].name;
        let checked = $(this).prop('checked');

        // dispatches each type of option to be handled
        if (box == 'opNames') {
            useOpNames(checked);
        } else if (box == 'insertConstants') {
            insertConstants(checked);
        } else if (box == 'largerText') {
            // Doesn't effect the settings text size
            document.getElementById('moduleData').style.fontSize = (checked) ? 'medium' : 'small';
        }
    });
});

$('#collapseAll').on('click', function() {
    let toggle_elements = document.getElementsByClassName('toggle');
    for (let i = 0; i < toggle_elements.length; i++) {
        if (toggle_elements[i].checked) {
            toggle_elements[i].click();
        }
    }
});

$('#clearAll').on('click', function() {
    toggleDisassemblyInput(true);
    clearDagData();
    d3.select('#dagSvg').selectAll('*').remove();
});