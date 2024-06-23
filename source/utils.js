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

function assert(statement, message) {
    if (statement == undefined || statement == false) {
        alert('Oh no, something went wrong: ' + message);
        throw new Error(message);
    }
}

// the spirv.json has value in json in the following form
// "OpSourceContinued": 2,
// this function takes the value '2' and returns "OpSourceContinued"
function mapValueToEnumKey(enumObject, valueToFine) {
    for (const [key, value] of Object.entries(enumObject)) {
        if (valueToFine == value) {
            return key;
        }
    }
    return 'VALUE_NOT_FOUND';
}

// input example: "rgb(0, 191, 255)"
// returns black or white
function invertedTextColor(rgaText) {
    // brings to "0, 191, 255"
    let rgb = rgaText.substring(rgaText.indexOf('(') + 1, rgaText.indexOf(')'));
    rgb = rgb.split(', ');
    const r = parseInt(rgb[0]);
    const g = parseInt(rgb[1]);
    const b = parseInt(rgb[2]);

    // http://stackoverflow.com/a/3943023/112731
    // use 176 instead of 186 as seems to work better
    return (r * 0.299 + g * 0.587 + b * 0.114) > 176 ? '#000000' : '#FFFFFF';
}

// IEEE binary string to float
function parseFloatString(value) {
    // edge case not handled below
    if (parseInt(value, 2) == 0) {
        return '0.0';
    }

    // index where exp and mantissa split for
    let index;
    let expDiff;
    let size = value.length;
    if (size == 32) {
        index = 9;
        expDiff = 127;
    } else if (size == 64) {
        index = 12;
        expDiff = 1023;
    } else {
        assert(false, 'Only 32 and 64 bit size floats supported')
    }

    let sign = (value[0] == '0') ? 1 : -1;
    let exp = parseInt(value.substring(1, index), 2) - expDiff;
    let mantissa = '1' + value.substring(index, size);

    let float = 0;
    for (let i = 0; i < mantissa.length; i++) {
        float += parseInt(mantissa[i]) ? Math.pow(2, exp) : 0;
        exp--;
    }

    let result = float * sign;
    if (parseInt(result) == result) {
        return '' + result + '.0';
    } else {
        return '' + result;
    }
}