from flask import Flask, request, jsonify
from supabase import create_client
import openai
import json
from dotenv import load_dotenv
import os
import logging
from collections import defaultdict
import time

app = Flask(__name__)

# הגדרת לוגים לקובץ
logging.basicConfig(
    filename='/home/streamlinesolutionsbo/app.log',
    level=logging.INFO,
    format='%(asctime)s %(levelname)s: %(message)s'
)

# טעינת משתני סביבה
load_dotenv()
openai.api_key = os.getenv("OPENAI_API_KEY")
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")

# יצירת לקוח Supabase
supabase = create_client(supabase_url, supabase_key)

# הגדרת פונקציות GPT
functions = [
    {
        "name": "run_sql_query",
        "description": "הרצת שאילתת SQL על הדאטה",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "שאילתת SQL (SELECT בלבד)"
                }
            },
            "required": ["query"]
        }
    }
]

# הודעת המערכת עבור GPT
system_message = {
    "role": "system",
    "content": (
        "אתה עוזר למשתמש לשלוף מידע מתוך טבלת SQL בשם inventory. "
        "לטבלה יש את העמודות הבאות:\n"
        "- id (מספר מזהה)\n"
        "- created_at (תאריך יצירה)\n"
        "- site_code (קוד אתר)\n"
        "- site_name (שם אתר)\n"
        "- wh_code (קוד מחסן)\n"
        "- wh_description (תיאור מחסן)\n"
        "- sku (מק״ט)\n"
        "- item_description (תיאור פריט)\n"
        "- supplier_sku (מק״ט ספק)\n"
        "- quantity_in_wh (כמות במחסן)\n"
        "- quantity_in_trucks_distribution (כמות במשאיות הפצה)\n"
        "- quantity_in_trucks_between_sites (כמות במשאיות בין אתרים)\n"
        "- location_in_wh (מיקום במחסן)\n\n"
        "When the user requests information from the table (e.g., quantity, location, or warehouse details), use the run_sql_query function to create an exact SQL query (SELECT only) based on the request. "
        "Write the query with the exact table and column names, and do not add a semicolon (;) at the end. "
        "After receiving the results from the function, respond in Hebrew in a friendly and clear manner, explaining the results (e.g., 'You have X units of SKU Y in warehouse Z'). "
        "If the user is continuing a previous conversation, use the context of the previous messages to understand the request (e.g., referring to a specific SKU or warehouse). "
        "If the request is an idle conversation (such as 'hi', 'thank you', or a general question), respond in a friendly manner in Hebrew without creating an SQL query, unless the request explicitly requires it. "
        "Never return the SQL query itself as a response to the user."
    )
}

# שמירת היסטוריית שיחה לפי IP של המשתמש
conversation_history = defaultdict(list)

@app.route('/query', methods=['POST'])
def query_inventory():
    logging.info(f"Received request: {request.get_json()}")
    try:
         # קבלת הקלט מהבקשה
        data = request.get_json(silent=True)
        if data is None:
            logging.error("Invalid JSON in request body")
            return jsonify({"error": "גוף הבקשה אינו JSON תקין"}), 400
        if 'user_input' not in data:
            logging.error("Missing user_input field")
            return jsonify({"error": "חסר שדה 'user_input' בבקשה"}), 400
        user_input = data['user_input']

        # זיהוי משתמש לפי IP (זמני, ניתן לשפר עם session ID)
        user_id = request.remote_addr

        # הוספת הודעת המערכת והיסטוריית השיחה
        messages = [system_message] + conversation_history[user_id] + [
            {"role": "user", "content": user_input}
        ]

        # קריאה ל-OpenAI
        try:
            response = openai.ChatCompletion.create(
                model="gpt-4o",
                messages=messages,
                functions=functions,
                function_call="auto"
            )
        except Exception as e:
            logging.error(f"OpenAI error: {str(e)}")
            return jsonify({"error": f"שגיאה בקריאה ל-OpenAI: {str(e)}"}), 500

        message = response["choices"][0]["message"]

        # עדכון היסטוריית השיחה
        conversation_history[user_id].append({"role": "user", "content": user_input})
        conversation_history[user_id].append(message)

        # הגבלת ההיסטוריה ל-10 הודעות אחרונות כדי לחסוך בזיכרון
        if len(conversation_history[user_id]) > 10:
            conversation_history[user_id] = conversation_history[user_id][-10:]

        # בדיקה אם GPT יצר שאילתת SQL
        if "function_call" in message:
            # חילוץ השאילתה והסרת ; אם קיים
            sql = json.loads(message["function_call"]["arguments"])["query"]
            sql = sql.rstrip(';').strip()
            logging.info(f"Generated SQL query: {sql}")

            # בדיקה שזו שאילתת SELECT
            if not sql.strip().lower().startswith("select"):
                logging.error("Non-SELECT query attempted")
                return jsonify({"error": "רק שאילתות SELECT מותרות"}), 400

            # הרצת השאילתה ב-Supabase
            try:
                result = supabase.rpc("execute_raw_sql", {"query": sql}).execute()
                result_data = result.data if result.data else []
                logging.info(f"Supabase query result: {result_data}")
            except Exception as e:
                logging.error(f"Supabase error: {str(e)}")
                return jsonify({"error": f"שגיאה בהרצת השאילתה ב-Supabase: {str(e)}"}), 500

            # שליחת התוצאה בחזרה ל-GPT לעיבוד
            try:
                follow_up = openai.ChatCompletion.create(
                    model="gpt-4o",
                    messages=[
                        *messages,
                        message,
                        {
                            "role": "function",
                            "name": "run_sql_query",
                            "content": json.dumps(result_data)
                        }
                    ]
                )
                final_response = follow_up["choices"][0]["message"]["content"]
                logging.info(f"GPT final response: {final_response}")

                # עדכון ההיסטוריה עם התגובה הסופית
                conversation_history[user_id].append(
                    {"role": "assistant", "content": final_response}
                )

                return jsonify({
                    "sql_query": sql,
                    "results": result_data,
                    "gpt_response": final_response
                }), 200
            except Exception as e:
                logging.error(f"GPT follow-up error: {str(e)}")
                return jsonify({"error": f"שגיאה בעיבוד התוצאה על ידי GPT: {str(e)}"}), 500
        else:
            # תגובה לשיחת סרק או בקשה ללא SQL
            final_response = message.get("content", "אין תגובה")
            logging.info(f"GPT final response (no SQL): {final_response}")

            # עדכון ההיסטוריה עם התגובה
            conversation_history[user_id].append(
                {"role": "assistant", "content": final_response}
            )

            return jsonify({
                "gpt_response": final_response
            }), 200

    except Exception as e:
        logging.error(f"General error: {str(e)}")
        return jsonify({"error": f"שגיאה כללית: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080, debug=True)
