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
// The search bar: finds instructions by text, by %id or by [index] and steps through the matches
//
// Hidden sections (see sections.js) are not laid out, so the browser's own Ctrl+F only sees part of a large module.
// This searches the text of every instruction instead and scrolls to the matches itself.
//

const searchInput = document.getElementById('searchInput');
const searchStatus = document.getElementById('searchStatus');

// Lower case text of every instruction, indexed by instruction index.
// Built on the first search and dropped whenever the displayed text changes (new module, OpNames, constants)
var searchTexts = undefined;
// Instruction indices matching the current query, in instruction order
var searchMatches = [];
// Position in searchMatches of the match that was scrolled to
var searchCurrent = -1;
// The instruction divs marked as matches, kept so clearing them doesn't need a DOM query
var searchMatchDivs = [];

// Call when a new module is loaded or the display is cleared
function resetSearch() {
    searchInput.value = '';
    searchTexts = undefined;
    clearSearchMatches();
    searchMatches = [];
    searchCurrent = -1;
    updateSearchStatus();
}

// Call after the text of the instructions changed (OpNames or constants toggled) so the matches follow the new text
function searchTextChanged() {
    searchTexts = undefined;
    if (searchInput.value.trim() != '') {
        runSearch();
    }
}

function getSearchTexts() {
    if (searchTexts == undefined) {
        // Sections away from the screen are not built until needed (see sections.js), the search needs all of them
        materializeAllSections();
        // Instruction divs are in instruction order in the document
        const instructionDivs = displayDiv.getElementsByClassName('instruction');
        searchTexts = new Array(instructionDivs.length);
        for (let i = 0; i < instructionDivs.length; i++) {
            const instructionDiv = instructionDivs[i];
            const index = parseInt(instructionDiv.id.substring('instruction_'.length));
            // collapsedText() instead of innerText, which forces layout (see sections.js)
            let text = collapsedText(instructionDiv);
            // Strip the "[N] " prefix so the index can't match as text
            text = text.substring(text.indexOf(']') + 1).trim();
            // Long strings are shown as "click to view", search the actual string
            if (debugStringMap.has(index)) {
                text += ' ' + debugStringMap.get(index);
            }
            searchTexts[index] = text.toLowerCase();
        }
    }
    return searchTexts;
}

function clearSearchMatches() {
    for (const instructionDiv of searchMatchDivs) {
        instructionDiv.classList.remove('searchMatch', 'searchCurrent');
    }
    searchMatchDivs = [];
}

function updateSearchStatus() {
    if (searchInput.value.trim() == '' || instructionMap.size == 0) {
        searchStatus.textContent = '';
    } else if (searchMatches.length == 0) {
        searchStatus.textContent = 'no matches';
    } else {
        searchStatus.textContent = (searchCurrent + 1) + ' / ' + searchMatches.length;
    }
}

// Scrolls to the current match and marks it
function showSearchCurrent() {
    const current = document.getElementsByClassName('searchCurrent');
    for (let i = current.length - 1; i >= 0; i--) {
        current[i].classList.remove('searchCurrent');
    }
    if (searchCurrent < 0) {
        return;
    }
    const index = searchMatches[searchCurrent];
    getInstructionDiv(index).classList.add('searchCurrent');
    scrollToInstruction(index);
}

// Finds the instructions matching the search box:
//   "%12"          the id, its definition and every use
//   "[12]"         the instruction index
//   anything else  case insensitive text, as displayed (so OpNames and constants are searchable when shown),
//                  so "12" also finds "%12", "%112" and 'OpName %12 "x"'
function runSearch() {
    const query = searchInput.value.trim();
    clearSearchMatches();
    searchMatches = [];

    if (query != '' && instructionMap.size > 0) {
        let match;
        if ((match = query.match(/^%(\d+)$/))) {
            const id = parseInt(match[1]);
            if (resultToInstructionMap.has(id)) {
                searchMatches.push(resultToInstructionMap.get(id));
            }
            if (id < idConsumers.length) {
                for (const consumer of idConsumers[id]) {
                    searchMatches.push(consumer);
                }
            }
            // Forward references (OpName, OpDecorate, OpPhi) use an id before it is defined
            searchMatches.sort((a, b) => a - b);
        } else if ((match = query.match(/^\[(\d+)\]$/))) {
            const index = parseInt(match[1]);
            if (index < instructionMap.size) {
                searchMatches.push(index);
            }
        } else {
            const needle = query.toLowerCase();
            const texts = getSearchTexts();
            for (let i = 0; i < texts.length; i++) {
                if (texts[i].includes(needle)) {
                    searchMatches.push(i);
                }
            }
        }
    }

    for (const index of searchMatches) {
        const instructionDiv = getInstructionDiv(index);
        instructionDiv.classList.add('searchMatch');
        searchMatchDivs.push(instructionDiv);
    }

    searchCurrent = (searchMatches.length > 0) ? 0 : -1;
    updateSearchStatus();
    showSearchCurrent();
}

// @param delta +1 for the next match, -1 for the previous one, wraps around
function stepSearch(delta) {
    if (searchMatches.length == 0) {
        return;
    }
    searchCurrent = (searchCurrent + delta + searchMatches.length) % searchMatches.length;
    updateSearchStatus();
    showSearchCurrent();
}

// Search while typing, but not on every keystroke of a fast typist
var searchTimer = undefined;
searchInput.addEventListener('input', function() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 150);
});

searchInput.addEventListener('keydown', function(event) {
    if (event.key == 'Enter') {
        event.preventDefault();
        clearTimeout(searchTimer);
        if (searchMatches.length == 0) {
            runSearch();
        } else {
            stepSearch(event.shiftKey ? -1 : 1);
        }
    } else if (event.key == 'Escape') {
        resetSearch();
        searchInput.blur();
    }
});

document.getElementById('searchNext').addEventListener('click', function() {
    stepSearch(1);
});
document.getElementById('searchPrev').addEventListener('click', function() {
    stepSearch(-1);
});

// "/" focuses the search box, like in a browser or editor, unless typing somewhere else
document.addEventListener('keydown', function(event) {
    const tag = event.target.tagName;
    if (event.key == '/' && tag != 'INPUT' && tag != 'TEXTAREA' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        searchInput.focus();
        searchInput.select();
    }
});
