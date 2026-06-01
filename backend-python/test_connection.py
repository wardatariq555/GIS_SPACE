import psycopg2

conn = psycopg2.connect(
    host="localhost",
    database="lahore_15min_city",
    user="postgres",
    password="YOUR_PASSWORD",
    port="5432"
)

print("Database connected successfully!")

conn.close()