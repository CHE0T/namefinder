start "Generator" cmd /k "cd /d C:\Users\andre\projects\namegenerator\backend && .\.venv\Scripts\activate && python -m uvicorn main:app --host 127.0.0.1 --port 8002"
start "Scraper" cmd /k "cd /d C:\Users\andre\projects\domainscraper\backend && .\.venv\Scripts\activate && python -m uvicorn main:app --host 127.0.0.1 --port 8001"
start "Frontend" cmd /k "cd /d C:\Users\andre\projects\namefinder\frontend && npm run dev"
