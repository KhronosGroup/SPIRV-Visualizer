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
// QUnitJS test suite
//

// Only load so many shaders in at a time
// If set to high, the browser can't hold the memory for all the shaders
var fileList = [];
var blobs = [];
var maxShaders = 25;
var currentShaders = 0;
var totalShaders = 0;

QUnit.module("QUnit Setup");
QUnit.test("Prevents 'no tests were run' false error", function(assert) {
    assert.true(true, '');
});

QUnit.testDone( function( details ) {
    if (details.module == "QUnit Setup") {
        return;
    }
    console.log('QUnit Test Done');

    // Clear loaded binaries from memory for JS GC to grab
    for (let i = 0; i < blobs.length; i++) {
        delete blobs[i].blob;
    }
    delete blobs;
    getShaders();
});

// Run QUnitJS test and parse binary
async function testFunction(assert) {
    for (let i = 0; i < blobs.length; i++) {
        var buffer = await blobs[i].blob.arrayBuffer();
        assert.true(parseBinaryStream(buffer), blobs[i].name);
    }
}

// non async function to start a QUnit Module
function loadedTestBlob() {
    currentShaders++;
    QUnit.module("Shader Test Suite [" + (totalShaders - maxShaders) + ":" + totalShaders + "]");
    if ((currentShaders >= maxShaders)) {
        // All blobs loaded
        QUnit.test("Should not crash", testFunction);
    }
}

// Grab binaries finals locally using Client side API method
// Since using responseType = "arraybuffer"
// Has to be async
async function ajaxOnLoad(e) {
    var blob = new Blob([this.response], {type: "application/octet-stream"});
    blobs.push({
        "blob" : blob,
        "name" : this.responseURL
    });
    loadedTestBlob();
}

// Called multiple times until all shaders are loaded and tested
async function getShaders() {
    if (totalShaders >= fileList.length) {
        alert("--- DONE ---");
        return;
    } else if (totalShaders + maxShaders > fileList.length) {
        // For last group of tests
        maxShaders = fileList.length - totalShaders;
    }

    blobs = [];
    currentShaders = 0;
    for (let i = 0; i < maxShaders; i++) {
        var xhr = new XMLHttpRequest();
        xhr.responseType = "arraybuffer";
        xhr.open("GET", fileList[totalShaders]);
        xhr.onload = ajaxOnLoad;
        xhr.send(null);
        totalShaders++;
    }
}

// Called when everything is loaded as normal from index.html
// Goal to simulate the normal flow as close as possible
function runTestSuite() {
    // Hide normal UI to prevent having to visually see
    document.getElementById("mainModuleContainer").style.visibility = "hidden";

    // Load each file from the tests.json folder
    // This should be running on localhost as there might be a lot of tests
    $.getJSON("tests/tests.json", function(json) {
        fileList = json.files;
        console.log("Total files: " + fileList.length);
        // Initial start of testing
        getShaders();
    });
}
