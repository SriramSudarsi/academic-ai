import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error: "GEMINI_API_KEY is not configured",
      },
      { status: 500 }
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
  });

  const modelsToTry = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
  ];

  const errors: Array<{
    model: string;
    error: string;
  }> = [];

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents:
          "You are testing the Gemini connection for an Academic AI application. Reply with exactly: Gemini connection successful.",
      });

      return NextResponse.json({
        success: true,
        model,
        message: response.text,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      console.error(`Gemini error with ${model}:`, errorMessage);

      errors.push({
        model,
        error: errorMessage,
      });
    }
  }

  return NextResponse.json(
    {
      success: false,
      error: "All Gemini test models failed.",
      attempts: errors,
    },
    { status: 503 }
  );
}