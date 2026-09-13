const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

type Classification = { index: number; skills: string[] };

export async function classifyTitles(
  titles: string[],
): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>();
  if (titles.length === 0) return result;

  const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const prompt = `You classify software development tasks by the skills required.

For each task, return "Frontend" if it involves user interface, layout, styling, or client-side behaviour; "Backend" if it involves servers, databases, APIs, authentication, or data processing; both if it requires both.

Tasks:
${titles.map((t, i) => `${i}: ${t}`).join("\n")}`;

  const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              index: { type: "INTEGER" },
              skills: {
                type: "ARRAY",
                items: { type: "STRING", enum: ["Frontend", "Backend"] },
              },
            },
            required: ["index", "skills"],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");

  const parsed: Classification[] = JSON.parse(text);
  for (const item of parsed) {
    if (item.index >= 0 && item.index < titles.length) {
      result.set(item.index, item.skills);
    }
  }
  return result;
}
