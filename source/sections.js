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
// The collapsible sections of the disassembly (pre-function sections, functions and blocks)
// and hiding the ones that are off screen so large modules stay fast
//

// Wraps the div with the proper HTML elements
// newDiv param must have been created prior to keep scope
function addCollapsibleWrapper(newDiv, appendDiv, type, attributeName, displayName) {
    var input = document.createElement('input');
    input.id  = 'collapsible_' + attributeName;
    input.className = 'toggle';
    input.type = 'checkbox';
    input.checked = true;
    input.style.display = 'none';  // hide checkbox

    var label = document.createElement('label');
    label.htmlFor = 'collapsible_' + attributeName;
    label.className = 'label-toggle label-' + type;
    label.innerHTML = displayName

    var wrapDiv = document.createElement('div');
    wrapDiv.className = 'collapsible-content';
    newDiv.id = type + '-' + attributeName;
    newDiv.className = type;

    wrapDiv.appendChild(newDiv);
    appendDiv.appendChild(input);
    appendDiv.appendChild(label);
    appendDiv.appendChild(wrapDiv);
}

// Large modules have hundreds of thousands of DOM nodes, which can take many seconds of style and layout to show.
// Sections (blocks and the pre-function sections) away from the visible part of displayDiv are hidden so the browser
// skips their style, layout and paint. They keep taking up space from the height estimate below, so the scroll bar is
// about right, and an IntersectionObserver shows them again as they get close to being scrolled to.
//
// Sections start hidden with content-visibility: hidden, then are switched to hidden="until-found" in the background.
// until-found lets Ctrl+F find text in a hidden section (the browser removes the attribute itself on a match), but
// Chrome lays out everything that is until-found on the first frame, which is as slow as not hiding anything.
// Switching after the first frame is cheap. (content-visibility: auto has the same first frame cost.)
var sectionObserver = undefined;
// How far outside the visible part of displayDiv sections are still shown, so normal scrolling doesn't show empty space
const sectionObserverMargin = '2000px';
// Sections close to the visible part of displayDiv
var nearSections = new Set();
// Sections already switched to hidden="until-found"
var searchableSections = new Set();
// Stops the background switch to until-found from a previous module
var sectionGeneration = 0;

function hideSection(section) {
    if (searchableSections.has(section)) {
        section.style.contentVisibility = '';
        section.setAttribute('hidden', 'until-found');
    } else {
        section.style.contentVisibility = 'hidden';
    }
}

function showSection(section) {
    section.style.contentVisibility = '';
    section.removeAttribute('hidden');
}

// Call before clearing displayDiv for a new module
function resetSections() {
    if (sectionObserver) {
        sectionObserver.disconnect();
        sectionObserver = undefined;
    }
    sectionGeneration++;
}

function hideOffscreenSections(sections) {
    const generation = ++sectionGeneration;
    // Without hidden="until-found" Ctrl+F wouldn't find text in hidden sections, so keep showing everything there
    if (!('onbeforematch' in document.body) || !window.IntersectionObserver) {
        return;
    }
    nearSections = new Set();
    searchableSections = new Set();

    sectionObserver = new IntersectionObserver(function(entries) {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                nearSections.add(entry.target);
                showSection(entry.target);
            } else {
                nearSections.delete(entry.target);
                hideSection(entry.target);
            }
        }
    }, {root: displayDiv, rootMargin: sectionObserverMargin + ' 0px'});

    // Show enough of the first sections so the first frame isn't empty, the observer takes over from there
    const firstShownInstructions = 1000;
    let shownInstructions = 0;
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const instructions = section.childElementCount;
        // Each instruction is about 1.3em tall. "auto" lets the browser use the real height once a section was shown
        section.style.containIntrinsicHeight = `auto ${(instructions * 1.3 + 1).toFixed(1)}em`;
        if (shownInstructions < firstShownInstructions) {
            shownInstructions += instructions;
            nearSections.add(section);
        } else {
            hideSection(section);
        }
        sectionObserver.observe(section);
    }

    // Switch to until-found a batch at a time while the browser is idle (each batch is a few ms)
    const requestIdle = window.requestIdleCallback || function(callback) {
        return setTimeout(callback, 1);
    };
    const batchSize = 100;
    let next = 0;
    function makeSearchable() {
        if (generation != sectionGeneration) {
            return;  // a new module was loaded
        }
        const end = Math.min(next + batchSize, sections.length);
        for (; next < end; next++) {
            const section = sections[next];
            searchableSections.add(section);
            if (!nearSections.has(section)) {
                hideSection(section);
            }
        }
        if (next < sections.length) {
            requestIdle(makeSearchable);
        }
    }
    requestIdle(makeSearchable);
}

// The elements with a class in the parts of displayDiv that are shown or about to be, for changes that only matter
// on screen. Much faster than searching the whole display on a large module.
// Instructions of a function that are outside its blocks (OpFunction, OpFunctionParameter, OpFunctionEnd) are not in
// a hidden section and always included.
function elementsNearView(className) {
    const display = document.getElementById('disassembleDisplayDiv');
    if (sectionObserver == undefined) {
        return Array.from(display.getElementsByClassName(className));
    }
    const elements = [];
    const add = function(collection) {
        // Not push(...collection), a huge collection would overflow the call stack
        for (let i = 0; i < collection.length; i++) {
            elements.push(collection[i]);
        }
    };
    for (const section of nearSections) {
        add(section.getElementsByClassName(className));
    }
    // display -> collapsible-content wrapper -> function div -> instructions, collapsible wrappers of blocks
    for (const wrapper of display.children) {
        const functionDiv = wrapper.firstElementChild;
        if (functionDiv == null || !functionDiv.classList.contains('function')) {
            continue;
        }
        for (const child of functionDiv.children) {
            if (child.classList.contains('instruction')) {
                add(child.getElementsByClassName(className));
            }
        }
    }
    return elements;
}

// Needs to be called before scrolling to an instruction that might be in a hidden section
function showInstructionSection(instructionDiv) {
    const section = instructionDiv.closest('.label, .preFunction');
    if (section) {
        showSection(section);
    }
}

// Scrolls the disassembly to an instruction, uncollapsing and showing its section first
function scrollToInstruction(index) {
    const instructionDiv = document.getElementById('instruction_' + index);
    if (instructionDiv == null) {
        return;
    }
    uncollapseInstruction(instructionDiv);
    showInstructionSection(instructionDiv);
    instructionDiv.scrollIntoView({block: 'center'});
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
