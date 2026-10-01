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

// Escapes text so it can be safely concatenated into an innerHTML string
function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Display a float value, always with a decimal point so it doesn't look like an int
function formatFloat(value) {
    if (Number.isNaN(value)) {
        return 'NaN';
    } else if (value == Infinity) {
        return 'Inf';
    } else if (value == -Infinity) {
        return '-Inf';
    } else if (Object.is(value, -0)) {
        return '-0.0';
    }
    const result = '' + value;
    // Don't append to things like "1e+21"
    return (result.includes('.') || result.includes('e')) ? result : result + '.0';
}

// Decodes floats smaller than 32-bit that have an implicit leading 1 bit and an exponent bias of (2^(expBits-1) - 1)
// @param ieeeInfNaN true when an all-ones exponent is Inf/NaN (IEEE style),
//        false when only the all-ones exponent and mantissa is NaN and there is no Inf (Float8E4M3)
function decodeSmallFloat(bits, expBits, mantissaBits, ieeeInfNaN) {
    const sign = ((bits >>> (expBits + mantissaBits)) & 1) ? -1 : 1;
    const exp = (bits >>> mantissaBits) & ((1 << expBits) - 1);
    const mantissa = bits & ((1 << mantissaBits) - 1);
    const expMax = (1 << expBits) - 1;
    const bias = (1 << (expBits - 1)) - 1;

    if (ieeeInfNaN && exp == expMax) {
        return (mantissa == 0) ? sign * Infinity : NaN;
    } else if (!ieeeInfNaN && exp == expMax && mantissa == ((1 << mantissaBits) - 1)) {
        return NaN;
    } else if (exp == 0) {
        // zero and denormals
        return sign * mantissa * Math.pow(2, 1 - bias - mantissaBits);
    }
    return sign * (1 + mantissa / (1 << mantissaBits)) * Math.pow(2, exp - bias);
}

const floatView = new DataView(new ArrayBuffer(8));

// Turns the words of a OpConstant/OpSpecConstant float literal into a display string
// @param lowWord The first (low-order) word of the literal
// @param highWord The second word, only used for 64-bit
// @param width The OpTypeFloat Width
// @param encoding The OpTypeFloat Floating Point Encoding, undefined if not set
function floatLiteralToString(lowWord, highWord, width, encoding) {
    // Older SPIRV-Headers don't have FPEncoding
    const fpEncoding = spirv.Enums.FPEncoding || {};
    let value;
    if (width == 64) {
        floatView.setUint32(0, highWord);
        floatView.setUint32(4, lowWord);
        value = floatView.getFloat64(0);
    } else if (width == 32) {
        floatView.setUint32(0, lowWord);
        value = floatView.getFloat32(0);
    } else if (width == 16 && encoding !== undefined && encoding == fpEncoding.BFloat16KHR) {
        // bfloat16 is the top half of a 32-bit float
        floatView.setUint32(0, (lowWord & 0xFFFF) << 16);
        value = floatView.getFloat32(0);
    } else if (width == 16) {
        value = decodeSmallFloat(lowWord & 0xFFFF, 5, 10, true);
    } else if (width == 8 && encoding !== undefined && encoding == fpEncoding.Float8E4M3EXT) {
        value = decodeSmallFloat(lowWord & 0xFF, 4, 3, false);
    } else if (width == 8 && encoding !== undefined && encoding == fpEncoding.Float8E5M2EXT) {
        value = decodeSmallFloat(lowWord & 0xFF, 5, 2, true);
    } else {
        assert(false, 'parsing ' + width + ' bit float is not supported');
    }
    return formatFloat(value);
}
