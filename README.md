# NoteVault

A normal React + Node.js application for organizing PDF screenshots with OCR and OpenAI category detection.

## Technology

- Frontend: React and Vite
- Backend: Node.js and Express
- OCR: Tesseract.js in the browser
- Category detection: OpenAI Responses API
- Storage: local `data/database.json` and `data/uploads/`
- Login: email/password with an HTTP-only session cookie

## Run the project

1. Install Node.js 20 or newer.
2. Open this folder in the VS Code terminal.
3. Install packages:

   ```powershell
   npm install
   ```

4. Copy `.env.example` to `.env`.
5. Put a newly created API key in `.env`:

   ```text
   OPENAI_API_KEY=your_new_key
   OPENAI_MODEL=gpt-5.5
   SESSION_SECRET=replace-this-with-a-long-random-value
   PORT=3001
   ```

6. Start both the React frontend and Node backend:

   ```powershell
   npm run dev
   ```

7. Open `http://localhost:5173`.

The API key is read only by `server/index.js`. It is never sent to the browser, saved in the database, or committed to Git. Do not put a real key in `.env.example`.

## Project folders

```text
src/                 React frontend
server/index.js      Express backend and OpenAI call
data/                Saved accounts, categories, and uploaded images
.env                  Your private API key (ignored by Git)
```
