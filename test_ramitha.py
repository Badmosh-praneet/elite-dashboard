import os, psycopg
from dotenv import load_dotenv
load_dotenv()
cx = psycopg.connect(os.getenv('DATABASE_URL'))
res = cx.execute("SELECT booking_id, customer_name, model_year, source_sheet FROM booking WHERE customer_name = 'RAMITHA'").fetchall()
for r in res: print(r)
