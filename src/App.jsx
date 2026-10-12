import { useEffect, useMemo, useState } from "react";
import { BookOpen, FolderPlus, ImagePlus, LogOut, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { createWorker } from "tesseract.js";

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => { api("/api/auth/me").then(({ user }) => setUser(user)).catch(() => {}).finally(() => setChecking(false)); }, []);
  if (checking) return <div className="center"><div className="spinner" /></div>;
  if (!user) return <Auth onLogin={setUser} />;
  return <Library user={user} onLogout={() => setUser(null)} />;
}

function Auth({ onLogin }) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api(`/api/auth/${register ? "register" : "login"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      onLogin(result.user);
    } catch (problem) { setError(problem.message); }
  }
  return <main className="auth-page"><section className="auth-card"><div className="logo"><BookOpen /> NoteVault</div><h1>{register ? "Create your account" : "Welcome back"}</h1><p>Save PDF screenshots and let OpenAI organize them.</p><form onSubmit={submit}>{register && <label>Name<input name="name" required /></label>}<label>Email<input name="email" type="email" required /></label><label>Password<input name="password" type="password" minLength="6" required /></label>{error && <div className="error">{error}</div>}<button className="primary">{register ? "Create account" : "Log in"}</button></form><button className="text-button" onClick={() => { setRegister(!register); setError(""); }}>{register ? "Already registered? Log in" : "New here? Create an account"}</button></section></main>;
}

function Library({ user, onLogout }) {
  const [categories, setCategories] = useState([]);
  const [notes, setNotes] = useState([]);
  const [active, setActive] = useState("all");
  const [query, setQuery] = useState("");
  const [showCategory, setShowCategory] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [message, setMessage] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [previewNote, setPreviewNote] = useState(null);
  useEffect(() => { api("/api/library").then((result) => { setCategories(result.categories); setNotes(result.notes); }).catch((error) => setMessage(error.message)); }, []);
  const filtered = useMemo(() => notes.filter((note) => (active === "all" || note.categoryId === active) && `${note.fileName} ${note.ocrText}`.toLowerCase().includes(query.toLowerCase())), [notes, active, query]);

  async function logout() { await api("/api/auth/logout", { method: "POST" }); onLogout(); }
  async function deleteNote(note) {
    if (!confirm(`Delete ${note.fileName}?`)) return;
    try { await api(`/api/notes/${note.id}`, { method: "DELETE" }); setNotes((items) => items.filter((item) => item.id !== note.id)); }
    catch (error) { setMessage(error.message); }
  }
  async function moveNote(id, categoryId) {
    setNotes((items) => items.map((item) => item.id === id ? { ...item, categoryId: categoryId || null } : item));
    await api(`/api/notes/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ categoryId }) });
  }

  async function deleteMany() {
    const categoryId = active === "all" ? "" : active;
    const category = categories.find((item) => item.id === categoryId);
    const count = notes.filter((note) => !categoryId || note.categoryId === categoryId).length;
    if (!count) return;
    const description = category ? `all ${count} images in “${category.name}”` : `all ${count} saved images`;
    if (!confirm(`Permanently delete ${description}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    try {
      const suffix = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : "";
      const result = await api(`/api/notes${suffix}`, { method: "DELETE" });
      setNotes((items) => items.filter((note) => categoryId && note.categoryId !== categoryId));
      setMessage(`${result.deleted} ${result.deleted === 1 ? "image" : "images"} deleted.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBulkDeleting(false);
    }
  }

  return <main className="layout"><aside><div className="logo"><BookOpen /> NoteVault</div><button className="primary add" onClick={() => setShowUpload(true)}><ImagePlus size={18} /> Add screenshots</button><nav><button className={active === "all" ? "active" : ""} onClick={() => setActive("all")}>All images <b>{notes.length}</b></button><div className="nav-title"><span>Categories</span><button onClick={() => setShowCategory(true)}><Plus size={16} /></button></div>{categories.map((category) => <button className={active === category.id ? "active" : ""} key={category.id} onClick={() => setActive(category.id)}><i className={category.color} />{category.name}<b>{notes.filter((note) => note.categoryId === category.id).length}</b></button>)}</nav><div className="account"><span>{user.name[0]?.toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.email}</small></div><button onClick={logout} title="Log out"><LogOut size={17} /></button></div></aside><section className="workspace"><header><div className="search"><Search size={18} /><input placeholder="Search your notes" value={query} onChange={(event) => setQuery(event.target.value)} /></div></header><div className="content"><div className="heading"><div><small>YOUR VISUAL KNOWLEDGE BASE</small><h1>{active === "all" ? `Welcome, ${user.name.split(" ")[0]}` : categories.find((item) => item.id === active)?.name}</h1><p>OpenAI reads every screenshot and selects the best category.</p></div><button className="primary mobile-add" onClick={() => setShowUpload(true)}><Plus size={17} /> Upload</button></div>{message && <div className="notice" onClick={() => setMessage("")}>{message}</div>}<div className="stats"><article><ImagePlus /><div><strong>{notes.length}</strong><span>Saved images</span></div></article><article><FolderPlus /><div><strong>{categories.length}</strong><span>Categories</span></div></article><article><Sparkles /><div><strong>{notes.length ? Math.round(notes.reduce((sum, note) => sum + note.confidence, 0) / notes.length) : 0}%</strong><span>Average confidence</span></div></article></div><div className="section-title"><h2>Your notes</h2><span>{filtered.length} items</span><button className="bulk-delete" disabled={bulkDeleting || !notes.some((note) => active === "all" || note.categoryId === active)} onClick={deleteMany}><Trash2 size={14} /> {bulkDeleting ? "Deleting…" : active === "all" ? "Delete all images" : "Delete category images"}</button></div>{filtered.length ? <div className="grid">{filtered.map((note) => <article className="note" key={note.id}><div className="photo"><button className="image-open" onClick={() => setPreviewNote(note)} aria-label={`Open ${note.fileName}`}><img src={`/api/images/${note.id}`} alt={note.fileName} /></button><button className="delete" onClick={() => deleteNote(note)}><Trash2 size={14} /> Delete</button><span className="match">{note.confidence}% match</span></div><div className="note-info"><select value={note.categoryId || ""} onChange={(event) => moveNote(note.id, event.target.value)}><option value="">Needs review</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select><h3>{note.ocrText.split("\n").find(Boolean)?.slice(0, 90) || note.fileName}</h3><p>{note.reason}</p></div></article>)}</div> : <div className="empty"><ImagePlus size={34} /><h2>No images here</h2><p>Create categories, then upload up to 20 screenshots.</p></div>}</div></section>{showCategory && <CategoryDialog onClose={() => setShowCategory(false)} onCreate={(category) => setCategories((items) => [...items, category])} />}{showUpload && <UploadDialog categories={categories} onClose={() => setShowUpload(false)} onUploaded={(note) => setNotes((items) => [note, ...items])} />}{previewNote && <ImagePreview note={previewNote} onClose={() => setPreviewNote(null)} />}</main>;
}

function ImagePreview({ note, onClose }) {
  useEffect(() => {
    function closeOnEscape(event) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return <div className="image-modal" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="image-preview"><button className="preview-close" onClick={onClose} aria-label="Close image"><X size={20} /></button><img src={`/api/images/${note.id}`} alt={note.fileName} /><div><strong>{note.fileName}</strong><span>{note.confidence}% category match</span></div></section></div>;
}

function CategoryDialog({ onClose, onCreate }) {
  const [error, setError] = useState("");
  async function submit(event) { event.preventDefault(); try { const category = await api("/api/categories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); onCreate(category); onClose(); } catch (problem) { setError(problem.message); } }
  return <div className="modal"><form className="dialog" onSubmit={submit}><h2>Create a category</h2><p>Only the category name is needed.</p><label>Category name<input name="name" placeholder="Computer Graphics" required autoFocus /></label><label>Color<select name="color"><option value="violet">Violet</option><option value="blue">Blue</option><option value="green">Green</option><option value="orange">Orange</option></select></label>{error && <div className="error">{error}</div>}<div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Create</button></div></form></div>;
}

function UploadDialog({ categories, onClose, onUploaded }) {
  const [items, setItems] = useState([]);
  const [working, setWorking] = useState(false);
  async function choose(event) {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith("image/")).slice(0, 20);
    setItems(files.map((file) => ({ name: file.name, status: "Waiting" })));
    if (!categories.length) return setItems([{ name: "", status: "Create at least one category first.", error: true }]);
    setWorking(true);
    const worker = await createWorker("eng");
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      try {
        setItems((list) => list.map((item, i) => i === index ? { ...item, status: "Reading text…" } : item));
        const result = await worker.recognize(file);
        setItems((list) => list.map((item, i) => i === index ? { ...item, status: "OpenAI is choosing a category…" } : item));
        const form = new FormData(); form.append("image", file); form.append("ocrText", result.data.text);
        const note = await api("/api/notes", { method: "POST", body: form });
        onUploaded(note);
        setItems((list) => list.map((item, i) => i === index ? { ...item, status: "Saved", done: true } : item));
      } catch (problem) { setItems((list) => list.map((item, i) => i === index ? { ...item, status: problem.message, error: true } : item)); }
    }
    await worker.terminate(); setWorking(false);
  }
  return <div className="modal"><section className="dialog upload"><h2>Upload screenshots</h2><p>Select up to 20 images. OCR runs locally; OpenAI performs category detection.</p><label className="drop"><ImagePlus size={30} /><strong>Choose images</strong><span>PNG, JPG or WEBP · maximum 12 MB each</span><input type="file" accept="image/*" multiple disabled={working} onChange={choose} /></label>{items.length > 0 && <div className="queue">{items.map((item, index) => <div key={`${item.name}-${index}`}><span>{item.name || "Upload"}</span><small className={item.error ? "bad" : item.done ? "good" : ""}>{item.status}</small></div>)}</div>}<div className="actions"><button onClick={onClose} disabled={working}>{working ? "Processing…" : "Close"}</button></div></section></div>;
}
