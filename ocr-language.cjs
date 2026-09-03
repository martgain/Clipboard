const ARABIC_SCRIPT = /\p{Script=Arabic}/u;
const LATIN_SCRIPT = /\p{Script=Latin}/u;
const LETTER = /\p{Letter}/u;
const MAX_CODE_POINTS = 10000;

function detectOcrLanguage(text) {
  if (typeof text !== "string") {
    throw new TypeError("OCR text must be a string");
  }

  return classifyScriptCounts(countScriptLetters(text));
}

function countScriptLetters(text) {
  let arabicLetters = 0;
  let latinLetters = 0;
  let codePointsExamined = 0;

  for (const character of text) {
    codePointsExamined += 1;
    if (codePointsExamined > MAX_CODE_POINTS) {
      break;
    }
    if (!LETTER.test(character)) {
      continue;
    }
    arabicLetters += Number(ARABIC_SCRIPT.test(character));
    latinLetters += Number(LATIN_SCRIPT.test(character));
    if (arabicLetters > 0 && latinLetters > 0) {
      break;
    }
  }

  return { arabicLetters, latinLetters };
}

function classifyScriptCounts(scriptCounts) {
  if (scriptCounts.arabicLetters > 0 && scriptCounts.latinLetters > 0) {
    return "mixed";
  }
  if (scriptCounts.arabicLetters > 0) {
    return "ar";
  }
  if (scriptCounts.latinLetters > 0) {
    return "en";
  }
  return "unknown";
}

module.exports = { detectOcrLanguage };
