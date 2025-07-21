
// test_gemini_key.mjs
import { GoogleGenAI } from "@google/genai";

async function testApiKey(apiKey) {
  if (!apiKey) {
    console.log("KHÔNG HỢP LỆ: Không có khóa API nào được cung cấp.");
    return;
  }
  try {
    const genAI = new GoogleGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    await model.generateContent("Test");
    console.log("HỢP LỆ");
  } catch (error) {
    console.log(`KHÔNG HỢP LỆ: ${error.message}`);
  }
}

const apiKey = "AIzaSyBfHaBO8rwgyAR_rpZ0KX9fnT2jG-esDzw";
testApiKey(apiKey);
