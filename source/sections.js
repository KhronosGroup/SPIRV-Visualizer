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

// Large modules have hundreds of thousands of instructions, millions of DOM nodes. Building them all takes seconds and
// the browser then spends more seconds on style and layout. So the HTML of each section (a block or a pre-function
// section) is only turned into DOM when the section comes close to the visible part of displayDiv: sections start as an
// empty div with a height estimate (so the scroll bar is about right) and content-visibility: hidden, an
// IntersectionObserver builds and shows them as they get near, and hides them again when they are far away.
//
// Anything that needs the DOM of an instruction goes through getInstructionDiv(), which builds its section first, and
// anything that walks every instruction calls materializeAllSections() first.
// The browser's Ctrl+F only sees sections that have been built, the search bar (search.js) covers the whole module.
var sectionObserver = undefined;
// How far outside the visible part of displayDiv sections are still shown, so normal scrolling doesn't show empty space
const sectionObserverMargin = '2000px';
// Sections close to the visible part of displayDiv
var nearSections = new Set();
// HTML of the instructions of the sections that are not built yet: section div -> html string
var pendingSectionHtml = new Map();
// The section div (block, pre-function section or function div) of every instruction index
var instructionSections = [];
// Instructions in each section div (pre-function section, function or block)
var sectionInstructionCounts = new Map();
// Set by main.js, applies the OpNames / Insert Constants settings to a freshly built section
var onSectionMaterialized = undefined;

// Builds the DOM of a section if it only exists as HTML so far
function materializeSection(section) {
    const html = pendingSectionHtml.get(section);
    if (html != undefined) {
        pendingSectionHtml.delete(section);
        section.insertAdjacentHTML('beforeend', html);
        if (onSectionMaterialized) {
            onSectionMaterialized(section);
        }
    }
}

// For anything that has to see every instruction (Copy To Clipboard, the search text). Costs about as much as the
// page used to cost to load, once
function materializeAllSections() {
    for (const section of Array.from(pendingSectionHtml.keys())) {
        materializeSection(section);
    }
}

// The div of an instruction, building its section first if needed. undefined for an unknown index
function getInstructionDiv(index) {
    let instructionDiv = document.getElementById('instruction_' + index);
    if (instructionDiv == null && instructionSections[index] != undefined) {
        materializeSection(instructionSections[index]);
        instructionDiv = document.getElementById('instruction_' + index);
    }
    return instructionDiv || undefined;
}

function hideSection(section) {
    section.style.contentVisibility = 'hidden';
}

function showSection(section) {
    materializeSection(section);
    section.style.contentVisibility = '';
}

// Call before clearing displayDiv for a new module
function resetSections() {
    if (sectionObserver) {
        sectionObserver.disconnect();
        sectionObserver = undefined;
    }
    nearSections = new Set();
    pendingSectionHtml = new Map();
    instructionSections = [];
    sectionInstructionCounts = new Map();
}

// Call at the end of parsing with every section div, in document order
function hideOffscreenSections(sections) {
    if (!window.IntersectionObserver) {
        materializeAllSections();
        return;
    }

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
        const instructions = sectionInstructionCounts.get(section) || 0;
        // Each instruction is about 1.3em tall. "auto" lets the browser use the real height once a section was shown
        section.style.containIntrinsicHeight = `auto ${(instructions * 1.3 + 1).toFixed(1)}em`;
        if (shownInstructions < firstShownInstructions) {
            shownInstructions += instructions;
            nearSections.add(section);
            showSection(section);
        } else {
            hideSection(section);
        }
        sectionObserver.observe(section);
    }
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
// (getInstructionDiv() has built it, this makes it visible without waiting for the observer)
function showInstructionSection(instructionDiv) {
    const section = instructionDiv.closest('.label, .preFunction');
    if (section) {
        showSection(section);
    }
}

// Scrolls the disassembly to an instruction, uncollapsing and showing its section first
function scrollToInstruction(index) {
    const instructionDiv = getInstructionDiv(index);
    if (instructionDiv == undefined) {
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
