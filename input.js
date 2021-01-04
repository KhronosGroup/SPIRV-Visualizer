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

//
// Handle all DOM interface input interactions
//

// Load in file
function fileSelected(data, filename) {
    if (filename == undefined) {
        filename = "unknown";
    }
    document.getElementById("fileSelectName").innerText = "Loaded: " + filename;

    // Toggle div to be displayed
    // remove the rest as currently not support reloading spir-v without page refresh
    var preLoad = document.getElementById("preLoad");
    var filePrompt = document.getElementById("filePrompt");
    if (preLoad) {
        preLoad.remove();
    }
    if (filePrompt) {
        filePrompt.remove();
    }
    assert(data != undefined, "Failed to read in file");
    resetSettings();
    parseBinaryStream(data);
}

const fileSelector = document.getElementById("fileSelector");
const fileSelectorTop = document.getElementById("fileSelectorTop");
function fileSelect(event) {
    const reader = new FileReader();
    reader.onload = function() {
        var filename = (event.target.files) ? event.target.files[0].name : undefined;
        fileSelected(reader.result, filename);
    };
    reader.readAsArrayBuffer(event.target.files[0]);
};
fileSelector.addEventListener("change", fileSelect, false);
fileSelectorTop.addEventListener("change", fileSelect, false);

// This is needed or else the browser will try to download files
function dragOverHandler(event) {
    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy'; // Explicitly show this is a copy.
}

// Assume single file
function dropHandler(event) {
    // Prevent default behavior (Prevent file from being opened)
    event.preventDefault();
    var file;
    if (event.dataTransfer.items) {
        // DataTransferItemList interface
        assert(event.dataTransfer.items[0].kind === 'file', "Can only load single files");
        file = event.dataTransfer.items[0].getAsFile();
    } else {
        // DataTransfer interface
        file = event.dataTransfer.files[0];
    }
    const reader = new FileReader();
    reader.onload = function() {
        filename = (file) ? file.name : undefined;
        fileSelected(reader.result, filename);
    };
    reader.readAsArrayBuffer(file);
}
const dropArea = document.getElementsByTagName("BODY")[0];
dropArea.addEventListener('drop', dropHandler, false);
dropArea.addEventListener('dragover', dragOverHandler, false);

function idOnClick(event) {
    // Returns DOMTokenList of all classes
    var classList = event.target.classList;
    var parent = event.target.parentElement;

    var id = undefined;
    // find "idN" where "N" is the SPIR-V ID value
    // Can't use innerText due to using opName option
    for (let value of classList.values()) {
        // make sure not to just grab "id" class
        if (value.startsWith("id") && (value.length > 2)) {
            id = parseInt(value.substring(2));
        }
    }
    assert(isNaN(id) == false, "id was NaN");

    // id will be of "instruction_x"
    var instruction = parseInt(parent.id.substring(parent.id.indexOf("_")+1));
    var hasResult = classList.contains("result");

    if (hasResult) {
        displayDagResult(id, instruction);
    } else {
        // Includes Result Types
        displayDagOperand(id, instruction);
    }
}

function operationOnClick(event) {
    var opcode = event.target.innerText;
    var parent = event.target.parentElement;
    // id will be of "instruction_x"
    var instruction = parseInt(parent.id.substring(parent.id.indexOf("_")+1));
    displayDagOpcode(opcode, instruction);
}

// Some settings are easier to reset than have stateful logic of inputs outside this file
function resetSettings() {
    document.getElementById("opNames").checked = false;
}

// Sends all checkboxes out to handlers
$(document).ready(function(){
    $('input[type="checkbox"]').click(function(){
        var box = $(this)[0].name;
        var checked = $(this).prop("checked");

        // dispatches each type of option to be handled
        if (box == "opNames") {
            useOpNames(checked);
        } else if (box == "largerText") {
            // Doesn't effect the settings text size
            document.getElementById("moduleData").style.fontSize = (checked) ? "medium" : "small";
        }
    });
});
