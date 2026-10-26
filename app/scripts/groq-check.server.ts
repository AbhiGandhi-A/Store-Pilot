import "dotenv/config";
import { isGroqConfigured, getGroqModel, verifyGroqConfiguration } from "../services/ai/groq.server";

console.log("Groq Configuration Check:");
console.log("=========================");
console.log("Configured:", isGroqConfigured());
console.log("Model:", getGroqModel());
console.log("Verification:", verifyGroqConfiguration());
console.log("=========================");
console.log("Expected: Configured=false, Model=null, Verification shows error");