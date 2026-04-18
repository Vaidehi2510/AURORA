import sys, os, json
sys.path.insert(0, '.')
os.makedirs('artifacts/embeddings', exist_ok=True)

from openai_model import get_openrouter_client, openrouter_extra_headers

ANALYST_MODEL = "meta-llama/llama-4-scout"

client = get_openrouter_client()
if not client:
    print("No client — API key missing")
    exit()

test_alert = {
    "headline": "Coordinated cyber-physical activity at Substation Alpha",
    "priority": "high",
    "confidence": 0.81,
    "location": "Substation Alpha",
    "evidence": [
        {"domain": "cyber", "event_type": "port_scan", "title": "Port scan targeting Modbus ICS protocol", "score": 0.91},
        {"domain": "physical", "event_type": "visual_anomaly", "title": "Visual anomaly at Substation Alpha", "score": 0.84},
        {"domain": "cyber", "event_type": "auth_failure", "title": "47 failed logins on SCADA HMI", "score": 0.88},
    ],
    "supporting_priors": [
        {"source": "RISI", "title": "Ukraine 2015 power grid attack", "similarity": 0.87},
    ]
}

print("Calling Llama 4 Scout via OpenRouter...")
response = client.chat.completions.create(
    model=ANALYST_MODEL,
    messages=[
        {"role": "system", "content": "You are a senior cyber-physical threat analyst. Return a JSON assessment with keys: analyst_verdict, confidence_score (0-100), threat_narrative, escalate (true/false), recommended_actions (list of strings). Return JSON only, no markdown."},
        {"role": "user", "content": "Analyze this AURORA alert and return your assessment:\n\n" + json.dumps(test_alert, indent=2)}
    ],
    extra_headers=openrouter_extra_headers(),
    temperature=0.1,
)

raw = response.choices[0].message.content or ""
print("Raw response:")
print(raw[:800])
print()

# Try to parse
try:
    result = json.loads(raw)
    print("PARSED SUCCESSFULLY")
    print("VERDICT: " + str(result.get("analyst_verdict", "N/A")))
    print("CONFIDENCE: " + str(result.get("confidence_score", "N/A")))
    print("ESCALATE: " + str(result.get("escalate", "N/A")))
    print("NARRATIVE: " + str(result.get("threat_narrative", "N/A"))[:200])
except Exception as e:
    print("Parse error: " + str(e))
    # Try extracting JSON block
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1:
        try:
            result = json.loads(raw[start:end+1])
            print("EXTRACTED JSON:")
            print("VERDICT: " + str(result.get("analyst_verdict", "N/A")))
        except Exception as e2:
            print("Second parse failed: " + str(e2))
