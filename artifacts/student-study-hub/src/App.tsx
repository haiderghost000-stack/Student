import { lazy, Suspense, type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlarmClock, ArrowLeft, Calculator, Check, CheckCheck, Clock3, Hash,
  FileText, Gamepad2, BookOpen, LayoutDashboard, ListTodo, LoaderCircle, MoreHorizontal, Pause,
  Moon, Pencil, Play, Plus, RotateCcw, Search, Settings2, StickyNote, Sun, Timer, Trash2, Upload, Zap,
  X, Minus, Sparkles, Target, CalendarDays, Flame, NotebookPen, Library,
} from 'lucide-react';
const PdfReader = lazy(() => import('./PdfReader'));
const createPdfCover = async (file: Blob) => (await import('./pdfCover')).createPdfCover(file);

type Task = { id: string; title: string; subject: string; dueDate: string; priority: string; completed: boolean };
type Note = { id: string; title: string; content: string; subject: string; updatedAt: string };
type PdfMeta = { id: string; name: string; size: number; addedAt: string; cover?: string };
type PdfRecord = PdfMeta & { file: File };
type MathQuestion = { first: number; second: number; operation: '+' | '−' | '×'; answer: number; options: number[] };
type XoMark = 'X' | 'O';
type XoBoard = (XoMark | null)[];
type NumberFeedback = 'idle' | 'higher' | 'lower' | 'won' | 'error';
type Section = 'overview' | 'tasks' | 'notes' | 'timer' | 'library' | 'games';
type ModalMode = 'task' | 'note' | null;

const navItems: { id: Section; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
  { id: 'tasks', label: 'المهام', icon: ListTodo },
  { id: 'notes', label: 'ملاحظاتي', icon: StickyNote },
  { id: 'timer', label: 'مؤقّت الدراسة', icon: Timer },
  { id: 'library', label: 'مكتبتي', icon: Library },
  { id: 'games', label: 'استراحة ذكية', icon: Gamepad2 },
];
const subjects = ['الرياضيات', 'العلوم', 'اللغة العربية', 'الإنجليزية', 'التاريخ', 'أخرى'];
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
function readStore<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(`رفيق-${key}`); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => readStore(key, initial));
  useEffect(() => { localStorage.setItem(`رفيق-${key}`, JSON.stringify(value)); }, [key, value]);
  return [value, setValue] as const;
}
function openPdfDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('rafiq-pdf-library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pdfs', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function savePdf(record: PdfRecord) {
  const db = await openPdfDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('pdfs', 'readwrite');
    transaction.objectStore('pdfs').put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}
async function fetchPdf(id: string): Promise<PdfRecord | undefined> {
  const db = await openPdfDb();
  const record = await new Promise<PdfRecord | undefined>((resolve, reject) => {
    const request = db.transaction('pdfs').objectStore('pdfs').get(id);
    request.onsuccess = () => resolve(request.result as PdfRecord | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return record;
}
async function removePdf(id: string) {
  const db = await openPdfDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction('pdfs', 'readwrite').objectStore('pdfs').delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}
async function listPdfs(): Promise<PdfMeta[]> {
  const db = await openPdfDb();
  const records = await new Promise<PdfRecord[]>((resolve, reject) => {
    const request = db.transaction('pdfs').objectStore('pdfs').getAll();
    request.onsuccess = () => resolve(request.result as PdfRecord[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return records.map(({ id, name, size, addedAt, cover }) => ({ id, name, size, addedAt, cover })).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}
const formatDate = (date = new Date()) => new Intl.DateTimeFormat('ar', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
const formatSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} ك.ب` : `${(size / 1024 / 1024).toFixed(1)} م.ب`;
function createMathQuestion(): MathQuestion {
  const operation = (['+', '−', '×'] as const)[Math.floor(Math.random() * 3)];
  let first = Math.floor(Math.random() * 12) + 2;
  let second = Math.floor(Math.random() * 10) + 2;
  if (operation === '−' && second > first) [first, second] = [second, first];
  const answer = operation === '+' ? first + second : operation === '−' ? first - second : first * second;
  const options = new Set([answer]);
  while (options.size < 4) {
    const offset = Math.floor(Math.random() * 15) - 7;
    options.add(Math.max(0, answer + (offset === 0 ? 8 : offset)));
  }
  return { first, second, operation, answer, options: Array.from(options).sort(() => Math.random() - 0.5) };
}

function App() {
  const [section, setSection] = useState<Section>('overview');
  const [tasks, setTasks] = usePersisted<Task[]>('tasks', []);
  const [notes, setNotes] = usePersisted<Note[]>('notes', []);
  const [theme, setTheme] = usePersisted<'light' | 'dark'>('theme', 'light');
  const [focusMinutes, setFocusMinutes] = usePersisted('focus-duration', 25);
  const [breakMinutes, setBreakMinutes] = usePersisted('break-duration', 5);
  const [stats, setStats] = usePersisted('stats', { sessions: 0, focusSeconds: 0, streak: 0, lastStudyDay: '' });
  const [modal, setModal] = useState<ModalMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [taskFilter, setTaskFilter] = useState('الكل');
  const [search, setSearch] = useState('');
  const [pdfs, setPdfs] = useState<PdfMeta[]>([]);
  const [activePdf, setActivePdf] = useState<PdfMeta | null>(null);
  const [activePdfFile, setActivePdfFile] = useState<Blob | null>(null);
  const [pdfError, setPdfError] = useState('');
  const [pdfUploading, setPdfUploading] = useState(false);
  const [retryingCoverIds, setRetryingCoverIds] = useState<Set<string>>(() => new Set());
  const [timerMode, setTimerMode] = useState<'focus' | 'break'>('focus');
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [xo, setXo] = useState<XoBoard>(Array(9).fill(null));
  const [xoMode, setXoMode] = useState<'computer' | 'two-player'>('computer');
  const [memoryPairs, setMemoryPairs] = useState(6);
  const [memoryCards, setMemoryCards] = useState<string[]>([]);
  const [memoryOpen, setMemoryOpen] = useState<number[]>([]);
  const [memoryMatched, setMemoryMatched] = useState<number[]>([]);
  const [memoryMoves, setMemoryMoves] = useState(0);
  const [mathQuestion, setMathQuestion] = useState<MathQuestion>(() => createMathQuestion());
  const [mathFeedback, setMathFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [mathAnswer, setMathAnswer] = useState<number | null>(null);
  const [mathScore, setMathScore] = useState(0);
  const [mathStreak, setMathStreak] = useState(0);
  const [reactionStage, setReactionStage] = useState<'idle' | 'waiting' | 'ready' | 'result' | 'early'>('idle');
  const [reactionTime, setReactionTime] = useState<number | null>(null);
  const [reactionBest, setReactionBest] = useState<number | null>(null);
  const [secretNumber, setSecretNumber] = useState(() => Math.floor(Math.random() * 20) + 1);
  const [numberGuess, setNumberGuess] = useState('');
  const [numberAttempts, setNumberAttempts] = useState(0);
  const [numberHistory, setNumberHistory] = useState<number[]>([]);
  const [numberFeedback, setNumberFeedback] = useState<NumberFeedback>('idle');
  const pdfInput = useRef<HTMLInputElement>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionReadyAt = useRef(0);
  const coverRetryJobs = useRef(new Map<string, Promise<void>>());

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(''), 2600);
  };
  const retryPdfCover = (pdf: PdfMeta, notify = false): Promise<void> => {
    const existingJob = coverRetryJobs.current.get(pdf.id);
    if (existingJob) return existingJob;

    const job = (async () => {
      setRetryingCoverIds((current) => new Set(current).add(pdf.id));
      try {
        const record = await fetchPdf(pdf.id);
        if (!record) throw new Error('The saved PDF could not be found.');

        if (record.cover) {
          setPdfs((current) => current.map((item) => item.id === pdf.id ? { ...item, cover: record.cover } : item));
          return;
        }

        const cover = await createPdfCover(record.file);
        await savePdf({ ...record, cover });
        setPdfs((current) => current.map((item) => item.id === pdf.id ? { ...item, cover } : item));
        if (notify) {
          setPdfError('');
          showToast('تم تجهيز غلاف الملف بنجاح.');
        }
      } catch {
        setPdfError(`تعذّر تجهيز غلاف «${pdf.name}». بقي ملف PDF محفوظاً، ويمكنك المحاولة مجدداً.`);
      } finally {
        coverRetryJobs.current.delete(pdf.id);
        setRetryingCoverIds((current) => {
          const next = new Set(current);
          next.delete(pdf.id);
          return next;
        });
      }
    })();
    coverRetryJobs.current.set(pdf.id, job);
    return job;
  };
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const storedPdfs = await listPdfs();
        if (cancelled) return;
        setPdfs(storedPdfs);
        for (const pdf of storedPdfs) {
          if (cancelled) return;
          if (pdf.cover) continue;
          await retryPdfCover(pdf);
        }
      } catch {
        if (!cancelled) setPdfError('تعذّر فتح مكتبتك على هذا المتصفح.');
      }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (reactionStage !== 'waiting') return;
    const timeout = setTimeout(() => {
      reactionReadyAt.current = performance.now();
      setReactionStage('ready');
    }, 1300 + Math.random() * 2200);
    return () => clearTimeout(timeout);
  }, [reactionStage]);
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setSecondsLeft((value) => {
        if (value > 1) return value - 1;
        setRunning(false);
        if (timerMode === 'focus') {
          setStats((old) => {
            const today = new Date().toISOString().slice(0, 10);
            const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            return { sessions: old.sessions + 1, focusSeconds: old.focusSeconds + focusMinutes * 60, streak: old.lastStudyDay === today ? old.streak : old.lastStudyDay === yesterday ? old.streak + 1 : 1, lastStudyDay: today };
          });
          setTimerMode('break');
          showToast('أحسنت، حان وقت استراحة قصيرة.');
          return breakMinutes * 60;
        }
        setTimerMode('focus');
        showToast('انتهت الاستراحة، مستعد لجولة جديدة؟');
        return focusMinutes * 60;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [running, timerMode, focusMinutes, breakMinutes]);
  useEffect(() => { if (!running) setSecondsLeft((timerMode === 'focus' ? focusMinutes : breakMinutes) * 60); }, [focusMinutes, breakMinutes, timerMode, running]);
  const xoWinnerMark = xoWinner(xo);
  const xoTurn: XoMark = xo.filter((mark) => mark !== null).length % 2 === 0 ? 'X' : 'O';
  const xoDraw = !xoWinnerMark && xo.every((mark) => mark !== null);
  const computerTurn = xoMode === 'computer' && xoTurn === 'O' && !xoWinnerMark && !xoDraw;
  useEffect(() => {
    if (!computerTurn) return;
    const timeout = window.setTimeout(() => {
      const move = chooseXoMove(xo);
      if (move < 0) return;
      setXo((current) => {
        if (current[move] !== null || xoWinner(current) || current.every((mark) => mark !== null)) return current;
        const next = [...current];
        next[move] = 'O';
        return next;
      });
    }, 420);
    return () => window.clearTimeout(timeout);
  }, [computerTurn, xo, xoMode]);
  const completedCount = tasks.filter((task) => task.completed).length;
  const pendingTasks = tasks.filter((task) => !task.completed).length;
  const todayTasks = tasks.filter((task) => task.dueDate === new Date().toISOString().slice(0, 10) && !task.completed);
  const filteredTasks = useMemo(() => tasks.filter((task) => {
    const matchFilter = taskFilter === 'الكل' || (taskFilter === 'قيد الإنجاز' ? !task.completed : task.completed);
    return matchFilter && `${task.title} ${task.subject}`.includes(search.trim());
  }), [tasks, taskFilter, search]);
  const titleBySection: Record<Section, string> = { overview: 'نظرة عامة', tasks: 'مهامي الدراسية', notes: 'دفتر ملاحظاتي', timer: 'وقتٌ لك ولتركيزك', library: 'مكتبتي', games: 'استراحة تستحقها' };

  const openModal = (mode: Exclude<ModalMode, null>, id?: string) => { setEditingId(id || null); setModal(mode); };
  const saveTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const item: Task = { id: editingId || uid(), title: String(form.get('title')).trim(), subject: String(form.get('subject')), dueDate: String(form.get('dueDate')), priority: String(form.get('priority')), completed: editingId ? tasks.find((task) => task.id === editingId)?.completed || false : false };
    if (!item.title) return;
    setTasks((old) => editingId ? old.map((task) => task.id === editingId ? item : task) : [item, ...old]);
    setModal(null); showToast(editingId ? 'تم تحديث المهمة.' : 'أُضيفت المهمة إلى قائمتك.');
  };
  const saveNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const item: Note = { id: editingId || uid(), title: String(form.get('title')).trim(), subject: String(form.get('subject')), content: String(form.get('content')).trim(), updatedAt: new Date().toISOString() };
    if (!item.title) return;
    setNotes((old) => editingId ? old.map((note) => note.id === editingId ? item : note) : [item, ...old]);
    setModal(null); showToast(editingId ? 'تم تحديث الملاحظة.' : 'حُفظت ملاحظتك.');
  };
  const toggleTask = (id: string) => setTasks((old) => old.map((task) => task.id === id ? { ...task, completed: !task.completed } : task));
  const deleteTask = (id: string) => { if (window.confirm('هل تريد حذف هذه المهمة؟')) { setTasks((old) => old.filter((task) => task.id !== id)); showToast('تم حذف المهمة.'); } };
  const deleteNote = (id: string) => { if (window.confirm('هل تريد حذف هذه الملاحظة؟')) { setNotes((old) => old.filter((note) => note.id !== id)); showToast('تم حذف الملاحظة.'); } };
  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (!files.length) {
      if (event.target.files?.length) showToast('اختر ملفاً بصيغة PDF.');
      event.target.value = '';
      return;
    }
    setPdfUploading(true);
    try {
      let missingCovers = 0;
      for (const file of files) {
        let cover: string | undefined;
        try {
          cover = await createPdfCover(file);
        } catch {
          missingCovers += 1;
        }
        await savePdf({ id: uid(), name: file.name, size: file.size, addedAt: new Date().toISOString(), file, cover });
      }
      setPdfs(await listPdfs());
      setPdfError('');
      showToast(missingCovers
        ? `تمت إضافة الملفات، لكن تعذّر تجهيز غلاف ${missingCovers} منها.`
        : `تمت إضافة ${files.length} من الملفات مع أغلفتها.`);
    } catch {
      setPdfError('تعذّر حفظ الملف. جرّب ملفاً أصغر أو متصفحاً حديثاً.');
    } finally {
      setPdfUploading(false);
      event.target.value = '';
    }
  };
  const selectPdf = async (pdf: PdfMeta) => {
    try {
      const record = await fetchPdf(pdf.id);
      if (!record) { setPdfError('لم نعثر على الملف المحفوظ.'); return; }
      setActivePdfFile(record.file); setActivePdf(pdf); setPdfError('');
    } catch { setPdfError('تعذّر فتح الملف.'); }
  };
  const deletePdf = async (pdf: PdfMeta) => {
    if (!window.confirm(`حذف «${pdf.name}» من مكتبتك؟`)) return;
    await removePdf(pdf.id); setPdfs(await listPdfs());
    if (activePdf?.id === pdf.id) { setActivePdfFile(null); setActivePdf(null); }
    showToast('أُزيل الملف من مكتبتك.');
  };
  const setMode = (mode: 'focus' | 'break') => { setRunning(false); setTimerMode(mode); setSecondsLeft((mode === 'focus' ? focusMinutes : breakMinutes) * 60); };
  const resetTimer = () => { setRunning(false); setSecondsLeft((timerMode === 'focus' ? focusMinutes : breakMinutes) * 60); };
  const adjustDuration = (mode: 'focus' | 'break', amount: number) => {
    const setter = mode === 'focus' ? setFocusMinutes : setBreakMinutes;
    setter((value: number) => Math.min(90, Math.max(1, value + amount)));
  };
  const timerDisplay = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;
  const makeMemory = (pairs = memoryPairs) => {
    const symbols = ['ن', 'م', 'ع', 'ك', 'س', 'ل', 'ر', 'ت', 'ب', 'هـ'];
    const cards = [...symbols.slice(0, pairs), ...symbols.slice(0, pairs)].sort(() => Math.random() - .5);
    setMemoryPairs(pairs); setMemoryCards(cards); setMemoryOpen([]); setMemoryMatched([]); setMemoryMoves(0);
  };
  useEffect(() => { makeMemory(6); }, []);
  const chooseMemory = (index: number) => {
    if (memoryOpen.length >= 2 || memoryOpen.includes(index) || memoryMatched.includes(index)) return;
    const open = [...memoryOpen, index]; setMemoryOpen(open);
    if (open.length === 2) {
      setMemoryMoves((value) => value + 1);
      if (memoryCards[open[0]] === memoryCards[open[1]]) {
        setMemoryMatched((old) => [...old, ...open]);
        setTimeout(() => setMemoryOpen([]), 420);
      } else setTimeout(() => setMemoryOpen([]), 850);
    }
  };
  const chooseMathAnswer = (answer: number) => {
    if (mathFeedback) return;
    const correct = answer === mathQuestion.answer;
    setMathAnswer(answer);
    setMathFeedback(correct ? 'correct' : 'wrong');
    if (correct) { setMathScore((score) => score + 1); setMathStreak((streak) => streak + 1); }
    else setMathStreak(0);
  };
  const nextMathQuestion = () => { setMathQuestion(createMathQuestion()); setMathFeedback(null); setMathAnswer(null); };
  const resetNumberGame = () => {
    setSecretNumber(Math.floor(Math.random() * 20) + 1);
    setNumberGuess('');
    setNumberAttempts(0);
    setNumberHistory([]);
    setNumberFeedback('idle');
  };
  const submitNumberGuess = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (numberFeedback === 'won') return;
    const value = numberGuess.trim();
    const guess = Number(value);
    if (!value || !Number.isInteger(guess) || guess < 1 || guess > 20) {
      setNumberFeedback('error');
      return;
    }
    if (numberHistory.includes(guess)) {
      setNumberFeedback('error');
      return;
    }
    setNumberHistory((history) => [guess, ...history]);
    setNumberAttempts((attempts) => attempts + 1);
    setNumberFeedback(guess === secretNumber ? 'won' : guess < secretNumber ? 'higher' : 'lower');
  };
  const handleReactionTap = () => {
    if (reactionStage === 'waiting') { setReactionStage('early'); return; }
    if (reactionStage === 'ready') {
      const time = Math.round(performance.now() - reactionReadyAt.current);
      setReactionTime(time); setReactionBest((best) => best === null || time < best ? time : best); setReactionStage('result');
      return;
    }
    setReactionTime(null); setReactionStage('waiting');
  };
  const playXo = (index: number) => {
    if (xo[index] !== null || xoDraw || xoWinnerMark || computerTurn) return;
    setXo((old) => {
      if (old[index] !== null || xoWinner(old) || old.every((mark) => mark !== null)) return old;
      const mark: XoMark = old.filter((cell) => cell !== null).length % 2 === 0 ? 'X' : 'O';
      if (xoMode === 'computer' && mark !== 'X') return old;
      const next = [...old];
      next[index] = mark;
      return next;
    });
  };
  const changeXoMode = (mode: 'computer' | 'two-player') => {
    if (mode === xoMode) return;
    setXoMode(mode);
    setXo(Array(9).fill(null));
  };
  const resetXo = () => setXo(Array(9).fill(null));

  const renderTasks = (compact = false) => {
    const list = compact ? (todayTasks.length ? todayTasks : tasks.filter((task) => !task.completed)).slice(0, 4) : filteredTasks;
    if (!list.length) return <div className="empty"><div className="empty-icon"><CheckCheck size={21} /></div><strong>{compact ? 'مساحتك تبدأ من هنا' : 'لا توجد مهام هنا الآن'}</strong><p>{compact ? 'أضف مهمة صغيرة، واجعل يومك أوضح.' : 'أضف مهمة جديدة أو جرّب تغيير خيارات البحث.'}</p>{compact && <button className="soft-btn" style={{ marginTop: 13 }} onClick={() => openModal('task')}><Plus size={15} /> إضافة أول مهمة</button>}</div>;
    return <div className={compact ? '' : 'task-list'}>{list.map((task) => <div className="task-row" key={task.id}>
      <button className={`check-button ${task.completed ? 'checked' : ''}`} aria-label={task.completed ? 'إلغاء إكمال المهمة' : 'إكمال المهمة'} onClick={() => toggleTask(task.id)}>{task.completed && <Check size={13} />}</button>
      <div className="task-info"><div className={`task-name ${task.completed ? 'done' : ''}`}>{task.title}</div><div className="task-meta">{task.subject} {task.dueDate && ` · ${new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short' }).format(new Date(`${task.dueDate}T12:00:00`))}`}</div></div>
      <span className={`priority-label ${task.priority}`}>{task.priority}</span>
      {!compact && <div className="row-actions"><button className="small-icon" aria-label="تعديل المهمة" onClick={() => openModal('task', task.id)}><Pencil size={14} /></button><button className="small-icon" aria-label="حذف المهمة" onClick={() => deleteTask(task.id)}><Trash2 size={14} /></button></div>}
    </div>)}</div>;
  };

  return <div className="app-shell" data-theme={theme} dir="rtl">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><BookOpen size={22} /></div><div><div className="brand-name">منصة الطالب</div><div className="brand-sub">تعلم، تركيز، وإنجاز</div></div></div>
      <div className="nav-caption">مساحتك الدراسية</div>
      <nav className="nav-list">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} onClick={() => setSection(id)}><Icon size={18} strokeWidth={1.8} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="daily-card"><strong>خطوة هادئة تكفي</strong><p>لا تحتاج أن تنجز كل شيء اليوم. اختر ما يهم وابدأ منه.</p></div><div className="profile"><div className="profile-avatar">ط</div><div><div className="profile-name">رحلتك، على مهل</div><div className="profile-caption">مساحة دراسة شخصية</div></div></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">منصة الطالب <span style={{ margin: '0 8px', color: '#c0c9c2' }}>/</span> <b>{titleBySection[section]}</b></div><div className="top-actions"><span className="date-chip"><CalendarDays size={14} style={{ verticalAlign: 'middle', marginLeft: 6 }} />{formatDate()}</span><button className="icon-btn" title="ابدأ مؤقّت الدراسة" aria-label="ابدأ مؤقّت الدراسة" onClick={() => setSection('timer')}><AlarmClock size={17} /></button><button className="icon-btn theme-toggle" title={theme === 'dark' ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'} aria-label={theme === 'dark' ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'} aria-pressed={theme === 'dark'} onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button></div></header>
      <div className="page-head"><div><div className="eyebrow">{section === 'overview' ? 'مساحة صغيرة، إنجازات كبيرة' : 'مساحتك الدراسية'}</div><h1 className="page-title">{section === 'overview' ? 'أهلاً بك، لنبدأ على مهل' : titleBySection[section]}</h1><p className="page-subtitle">{section === 'overview' ? 'كل خطوة صغيرة اليوم تقرّبك مما تريد.' : section === 'tasks' ? 'رتّب ما عليك، واترك مساحة لما تحب.' : section === 'notes' ? 'أفكارك وملاحظاتك، في مكان واحد.' : section === 'timer' ? 'وقت تركيز واضح، تتبعه استراحة مستحقة.' : section === 'library' ? 'كتبك وملفاتك الدراسية قريبة منك.' : 'استراحة قصيرة تعيد ذهنك إلى صفائه.'}</p></div>
        {(section === 'tasks' || section === 'overview') && <button className="primary-btn" onClick={() => openModal('task')}><Plus size={16} /> مهمة جديدة</button>}
        {section === 'notes' && <button className="primary-btn" onClick={() => openModal('note')}><Plus size={16} /> ملاحظة جديدة</button>}
      </div>

      {section === 'overview' && <div className="content">
        <section className="overview-hero"><div className="hero-copy"><div className="eyebrow">مساء الخير، مسيرتك تستحق التقدير</div><h2 className="hero-title">خطوة واحدة بتركيز،<br /><span>تُحدث فرقاً.</span></h2><p className="hero-text">رتّب أولوياتك، خذ نفساً عميقاً، وامنح نفسك فرصة لتتعلم بطريقتك.</p><button className="hero-link" onClick={() => setSection('timer')}><Play size={14} /> ابدأ جلسة تركيز</button></div><div className="hero-orbit"><div className="hero-orbit-inner"><Sparkles size={27} /></div></div></section>
        <section className="stats-grid">
          {[{ label: 'مهام متبقية', value: pendingTasks, icon: Target, color: '#e6f0e8', ink: '#59806d' }, { label: 'أُنجزت هذا اليوم', value: completedCount, icon: CheckCheck, color: '#f5efdf', ink: '#ac8b4c' }, { label: 'جلسات تركيز', value: stats.sessions, icon: Clock3, color: '#e8edf0', ink: '#6b8590' }, { label: 'أيام متتابعة', value: stats.streak, icon: Flame, color: '#f5e9e4', ink: '#b57867' }].map((stat) => <div className="panel stat-card" key={stat.label}><div className="stat-icon" style={{ background: stat.color, color: stat.ink }}><stat.icon size={19} /></div><div><div className="stat-value">{stat.value}</div><div className="stat-label">{stat.label}</div></div></div>)}
        </section>
        <div className="overview-columns">
          <section className="panel section-panel"><div className="section-heading"><h2>على قائمة اليوم</h2><button className="text-link" onClick={() => setSection('tasks')}>كل المهام <ArrowLeft size={14} /></button></div>{todayTasks.length ? renderTasks(true) : renderTasks(true)}</section>
          <section className="panel section-panel"><div className="section-heading"><h2>ملاحظاتك الأخيرة</h2><button className="text-link" onClick={() => setSection('notes')}>دفتر الملاحظات <ArrowLeft size={14} /></button></div>{notes.length ? notes.slice(0, 2).map((note) => <div className="mini-note" key={note.id}><span className="note-subject">{note.subject}</span><h3>{note.title}</h3><p>{note.content || 'مساحة فارغة لفكرة جديدة.'}</p></div>) : <div className="empty"><div className="empty-icon"><NotebookPen size={20} /></div><strong>أفكارك لها مكان</strong><p>اكتب ملاحظة سريعة قبل أن تفوتك.</p><button className="text-link" style={{ margin: '12px auto 0' }} onClick={() => openModal('note')}><Plus size={14} /> أضف ملاحظة</button></div>}</section>
        </div>
      </div>}

      {section === 'tasks' && <div className="content">
        <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 15 }}><div className="filters">{['الكل', 'قيد الإنجاز', 'مكتملة'].map((filter) => <button key={filter} className={`filter-btn ${taskFilter === filter ? 'active' : ''}`} onClick={() => setTaskFilter(filter)}>{filter}</button>)}</div><label className="search-input" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Search size={15} color="#9ba8a1" /><input aria-label="ابحث عن مهمة" data-testid="input-search-tasks" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث عن مهمة أو مادة" style={{ border: 0, outline: 0, background: 'transparent', width: 170, fontSize: 12 }} /></label></div>
        <div className="panel">{renderTasks()}</div>
        {tasks.length > 0 && <div style={{ color: '#92a099', fontSize: 11, padding: '13px 4px' }}>أنجزت {completedCount} من أصل {tasks.length} مهمة</div>}
      </div>}

      {section === 'notes' && <div className="content">{notes.length ? <div className="notes-grid">{notes.map((note) => <article key={note.id} className="panel note-card" onClick={() => openModal('note', note.id)}><div className="note-card-top"><span className="note-subject">{note.subject}</span><button className="small-icon" aria-label="حذف الملاحظة" onClick={(event) => { event.stopPropagation(); deleteNote(note.id); }}><Trash2 size={14} /></button></div><h3>{note.title}</h3><p className="note-preview">{note.content || 'لا يوجد نص بعد.'}</p><div className="note-date">آخر تحديث · {new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'long' }).format(new Date(note.updatedAt))}</div></article>)}</div> : <div className="panel"><div className="empty"><div className="empty-icon"><StickyNote size={21} /></div><strong>دفترك ما زال ينتظر أول فكرة</strong><p>دوّن شرحاً، سؤالاً أو فكرة تخشى أن تنساها.</p><button className="primary-btn" style={{ marginTop: 16 }} onClick={() => openModal('note')}><Plus size={15} /> اكتب ملاحظة</button></div></div>}</div>}

      {section === 'timer' && <div className="content timer-layout">
        <section className="panel timer-main"><div className="timer-core"><div className="mode-switch"><button className={timerMode === 'focus' ? 'active' : ''} onClick={() => setMode('focus')}>تركيز</button><button className={timerMode === 'break' ? 'active' : ''} onClick={() => setMode('break')}>استراحة</button></div><div className="timer-display">{timerDisplay}</div><div className="timer-caption">{running ? timerMode === 'focus' ? 'أنت في جلسة تركيز، أحسنت.' : 'خذ نفساً عميقاً.' : 'كل دقيقة تمنحها لنفسك تستحق.'}</div><div className="timer-actions"><button className="round-btn" aria-label="إعادة ضبط المؤقت" onClick={resetTimer}><RotateCcw size={17} /></button><button className="round-btn play" aria-label={running ? 'إيقاف مؤقت' : 'ابدأ المؤقت'} onClick={() => setRunning((value) => !value)}>{running ? <Pause size={19} /> : <Play size={19} />}</button><button className="round-btn" aria-label="انتقل إلى الوضع التالي" onClick={() => setMode(timerMode === 'focus' ? 'break' : 'focus')}><ArrowLeft size={17} /></button></div></div></section>
        <section className="panel timer-settings"><div className="section-heading"><h2>تخصيص وقتك</h2><Settings2 size={17} color="#81948a" /></div>{([{ mode: 'focus' as const, label: 'مدة التركيز', value: focusMinutes }, { mode: 'break' as const, label: 'مدة الاستراحة', value: breakMinutes }]).map((item) => <div className="duration-row" key={item.mode}><span>{item.label}</span><div className="duration-control"><button aria-label={`تقليل ${item.label}`} onClick={() => adjustDuration(item.mode, -1)}><Minus size={13} /></button><b>{item.value}</b><button aria-label={`زيادة ${item.label}`} onClick={() => adjustDuration(item.mode, 1)}><Plus size={13} /></button><small style={{ color: '#94a19a' }}>دقيقة</small></div></div>)}<div className="session-info"><Clock3 size={14} style={{ verticalAlign: 'middle', marginLeft: 5 }} /> عند انتهاء المؤقت ينتقل تلقائياً إلى الوضع التالي. سيتم حفظ تفضيلاتك وجلساتك على هذا الجهاز.</div><div style={{ marginTop: 17, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8b9a92' }}><span>جلسات مكتملة</span><strong style={{ color: '#587a6d' }}>{stats.sessions}</strong></div></section>
      </div>}

      {section === 'library' && <div className="content pdf-library">
        <section className="panel pdf-list">
          <input ref={pdfInput} type="file" accept="application/pdf,.pdf" multiple hidden onChange={handleUpload} />
          <button className="upload-zone" style={{ width: '100%' }} disabled={pdfUploading} onClick={() => pdfInput.current?.click()}>
            <Upload size={19} />
            <strong>{pdfUploading ? 'جارٍ تجهيز أغلفة الملفات…' : 'أضف ملفاً إلى مكتبتك'}</strong>
            <span>ملفات PDF محفوظة على جهازك · الغلاف من الصفحة الأولى</span>
          </button>
          {pdfError && <div className="pdf-error" role="alert">{pdfError}</div>}
          <div className="section-heading" style={{ marginBottom: 7 }}>
            <h2>ملفاتك <span style={{ color: '#9aa69f', fontWeight: 400 }}>({pdfs.length})</span></h2>
            <MoreHorizontal size={17} color="#9aa69f" />
          </div>
          {pdfs.length ? pdfs.map((pdf) => {
            const isRetrying = retryingCoverIds.has(pdf.id);
            return <div key={pdf.id} className="pdf-row">
              <button onClick={() => selectPdf(pdf)} style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0, flex: 1, border: 0, background: 'transparent', textAlign: 'right', padding: 0 }}>
                <span className="pdf-cover" aria-hidden="true">
                  {pdf.cover ? <img src={pdf.cover} alt="" loading="lazy" /> : <FileText size={18} />}
                  <span className="pdf-cover-page">1</span>
                </span>
                <span className="pdf-row-info">
                  <span className="pdf-name">{pdf.name}</span>
                  <span className="pdf-meta">{formatSize(pdf.size)} · الغلاف: الصفحة الأولى</span>
                </span>
              </button>
              <div className="pdf-row-actions">
                {!pdf.cover && <button
                  className="pdf-retry-button"
                  aria-label={`إعادة تجهيز غلاف ${pdf.name}`}
                  disabled={isRetrying}
                  onClick={() => { void retryPdfCover(pdf, true); }}
                >
                  {isRetrying ? <LoaderCircle size={13} className="pdf-retry-spinner" /> : <RotateCcw size={13} />}
                  <span>{isRetrying ? 'جارٍ التجهيز' : 'إعادة المحاولة'}</span>
                </button>}
                <button className="small-icon" aria-label="حذف الملف" disabled={isRetrying} onClick={() => deletePdf(pdf)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>;
          }) : <div className="empty" style={{ padding: '25px 8px' }}><strong>مكتبتك فارغة</strong><p>أضف أول ملف دراسي لتقرأه هنا.</p></div>}
        </section>
      </div>}

      {section === 'games' && <div className="content games-grid">
        <section className="games-welcome"><div><span className="game-kicker"><Sparkles size={14} /> استراحة قصيرة</span><h2>جدّد نشاطك بلعبة خفيفة</h2><p>اختر لعبتك، خذ نفساً، ثم عُد إلى دراستك بذهن أصفى.</p></div><div className="games-welcome-icon"><Gamepad2 size={26} /></div></section>
        <section className="panel game-card xo-game">
          <div className="game-heading">
            <div className="game-heading-icon xo-icon"><Target size={18} /></div>
            <div className="game-heading-copy"><h2>إكس-أو</h2><p>{xoMode === 'computer' ? 'العب ضد الآلي أو بدّل إلى لاعبين' : 'جولة سريعة مع صديق'}</p></div>
            <button className="small-icon game-reset" aria-label="بدء جولة جديدة" onClick={resetXo}><RotateCcw size={15} /></button>
          </div>
          <div className="xo-mode-switch" role="group" aria-label="طريقة اللعب">
            <button className={xoMode === 'computer' ? 'active' : ''} aria-pressed={xoMode === 'computer'} onClick={() => changeXoMode('computer')}>ضد الآلي</button>
            <button className={xoMode === 'two-player' ? 'active' : ''} aria-pressed={xoMode === 'two-player'} onClick={() => changeXoMode('two-player')}>لاعبان</button>
          </div>
          <div className={`xo-turn ${xoWinnerMark || xoDraw ? 'finished' : ''}`} aria-live="polite">
            <span className="turn-dot" />
            {xoWinnerMark
              ? xoMode === 'computer'
                ? xoWinnerMark === 'X' ? 'أحسنت، فزت على الآلي!' : 'فاز الآلي هذه الجولة.'
                : <>الفائز: <b className={`turn-mark ${xoWinnerMark === 'X' ? 'x-mark' : 'o-mark'}`}>{xoWinnerMark}</b></>
              : xoDraw
                ? 'تعادل جميل.'
                : computerTurn
                  ? 'الآلي يفكر…'
                  : xoMode === 'computer'
                    ? <>دورك، أنت <b className="turn-mark x-mark">X</b></>
                    : <>الدور على <b className={`turn-mark ${xoTurn === 'X' ? 'x-mark' : 'o-mark'}`}>{xoTurn}</b></>}
          </div>
          <div className="xo-board">
            {xo.map((cell, index) => <button key={index} className={`xo-cell ${cell === 'X' ? 'x-mark' : ''} ${cell === 'O' ? 'o-mark' : ''}`} onClick={() => playXo(index)} disabled={cell !== null || Boolean(xoWinnerMark) || xoDraw || computerTurn} aria-label={`المربع ${index + 1}${cell ? `، ${cell}` : ''}`}>{cell}</button>)}
          </div>
          <div className="games-footer"><span className="game-hint">{xoMode === 'computer' ? 'أنت X والآلي O' : 'تتناوبان حتى يكتمل الصف'}</span><button className="game-action" onClick={resetXo}><RotateCcw size={14} /> جولة جديدة</button></div>
        </section>
        <section className="panel game-card memory-game"><div className="game-heading"><div className="game-heading-icon memory-icon"><Sparkles size={18} /></div><div className="game-heading-copy"><h2>لعبة الذاكرة</h2><p>اقلب البطاقات وابحث عن الأزواج</p></div><button className="small-icon game-reset" aria-label="إعادة لعبة الذاكرة" onClick={() => makeMemory()}><RotateCcw size={15} /></button></div><div className="memory-stats"><div className="memory-stat"><span>المحاولات</span><b>{memoryMoves}</b></div><div className="memory-stat"><span>الأزواج</span><b>{memoryMatched.length / 2}<i> / {memoryPairs}</i></b></div><label className="pair-picker">المستوى<select className="select-field" aria-label="عدد أزواج الذاكرة" value={memoryPairs} onChange={(event) => makeMemory(Number(event.target.value))}><option value={4}>سهل</option><option value={6}>متوسط</option><option value={8}>تحدّي</option></select></label></div><div className="memory-progress" aria-label={`تم العثور على ${memoryMatched.length / 2} من ${memoryPairs} أزواج`}><span style={{ width: `${memoryCards.length ? (memoryMatched.length / memoryCards.length) * 100 : 0}%` }} /></div><div className={`memory-grid pairs-${memoryPairs}`}>{memoryCards.map((symbol, index) => { const open = memoryOpen.includes(index) || memoryMatched.includes(index); const matched = memoryMatched.includes(index); return <button key={index} className={`memory-card ${open ? 'open' : ''} ${matched ? 'matched' : ''}`} onClick={() => chooseMemory(index)} disabled={matched} aria-pressed={open} aria-label={matched ? `زوج مكتمل، بطاقة ${symbol}` : open ? `بطاقة ${symbol}` : 'اكشف البطاقة'}><span className="memory-face" aria-hidden="true">{open ? symbol : <Sparkles size={18} />}</span></button>; })}</div><div className="games-footer">{memoryMatched.length === memoryCards.length && <span className="memory-win"><Check size={14} /> أحسنت، وجدت كل الأزواج!</span>}<button className="game-action" onClick={() => makeMemory()}><RotateCcw size={14} /> ابدأ من جديد</button></div></section>
        <section className="panel game-card math-game"><div className="game-heading"><div className="game-heading-icon math-icon"><Calculator size={18} /></div><div className="game-heading-copy"><h2>تحدّي الحساب</h2><p>أسئلة سريعة لتنشيط ذهنك</p></div><button className="small-icon game-reset" aria-label="إعادة نقاط تحدي الحساب" onClick={() => { setMathScore(0); setMathStreak(0); nextMathQuestion(); }}><RotateCcw size={15} /></button></div><div className="math-score-row"><span>إجابات صحيحة <b>{mathScore}</b></span><span>متتالية <b>{mathStreak}</b></span></div><div className="math-question-box"><span>أوجد الناتج</span><strong>{mathQuestion.first} <i>{mathQuestion.operation}</i> {mathQuestion.second} <i>=</i> ؟</strong></div><div className="math-options">{mathQuestion.options.map((answer) => <button key={answer} className={`math-option ${mathFeedback && answer === mathQuestion.answer ? 'correct' : ''} ${mathFeedback === 'wrong' && answer === mathAnswer ? 'incorrect' : ''}`} onClick={() => chooseMathAnswer(answer)} disabled={mathFeedback !== null} aria-pressed={mathAnswer === answer}>{answer}</button>)}</div><div className="games-footer"><span className={`math-feedback ${mathFeedback || ''}`} aria-live="polite">{mathFeedback === 'correct' ? 'إجابة صحيحة، أحسنت!' : mathFeedback === 'wrong' ? `الإجابة الصحيحة: ${mathQuestion.answer}` : 'اختر الإجابة الصحيحة'}</span>{mathFeedback && <button className="game-action" onClick={nextMathQuestion}>السؤال التالي <ArrowLeft size={14} /></button>}</div></section>
        <section className="panel game-card reaction-game"><div className="game-heading"><div className="game-heading-icon reaction-icon"><Zap size={18} /></div><div className="game-heading-copy"><h2>سرعة الاستجابة</h2><p>اختبر سرعة ردّة فعلك</p></div><span className="reaction-best">{reactionBest === null ? 'أفضل نتيجة —' : `أفضل نتيجة ${reactionBest} مللي ث`}</span></div><button className={`reaction-pad ${reactionStage}`} onClick={handleReactionTap} aria-live="polite" aria-label={reactionStage === 'ready' ? 'انقر الآن' : reactionStage === 'waiting' ? 'انتظر الإشارة' : 'انقر لبدء جولة سرعة الاستجابة'}><span className="reaction-light"><Zap size={23} /></span><strong>{reactionStage === 'idle' ? 'انقر لبدء الجولة' : reactionStage === 'waiting' ? 'انتظر اللون الأخضر…' : reactionStage === 'ready' ? 'الآن! انقر بسرعة' : reactionStage === 'early' ? 'بكّرت! انقر للمحاولة مجدداً' : `زمنك ${reactionTime} مللي ث · جولة جديدة؟`}</strong><span>{reactionStage === 'waiting' ? 'لا تنقر حتى تتغير الإشارة' : reactionStage === 'ready' ? 'اضغط هنا بأسرع ما تستطيع' : 'راقب الإشارة واستجب عند تغيّرها'}</span></button><div className="reaction-footer"><span className="game-hint">متوسط الاستجابة غالباً بين 200 و 300 مللي ثانية.</span>{reactionTime !== null && <span className="reaction-last">آخر محاولة: {reactionTime} مللي ث</span>}</div></section>
        <section className="panel game-card number-game">
          <div className="game-heading">
            <div className="game-heading-icon number-icon"><Hash size={18} /></div>
            <div className="game-heading-copy"><h2>خمن الرقم</h2><p>ابحث عن الرقم السري من 1 إلى 20</p></div>
            <button className="small-icon game-reset" aria-label="بدء جولة تخمين جديدة" onClick={resetNumberGame}><RotateCcw size={15} /></button>
          </div>
          <div className="number-game-play">
            <div className={`number-secret-badge ${numberFeedback === 'won' ? 'revealed' : ''}`} aria-label={numberFeedback === 'won' ? `الرقم هو ${secretNumber}` : 'الرقم السري مخفي'}>
              <span aria-hidden="true">{numberFeedback === 'won' ? secretNumber : '؟'}</span>
            </div>
            <div className="number-game-controls">
              <div className="number-game-stats"><span>المحاولات <b>{numberAttempts}</b></span><span>النطاق <b dir="ltr">1–20</b></span></div>
              <form className="number-guess-form" onSubmit={submitNumberGuess}>
                <input className="number-guess-input" type="number" min="1" max="20" step="1" inputMode="numeric" required aria-label="خمّن رقماً من 1 إلى 20" placeholder="اكتب رقمك" value={numberGuess} disabled={numberFeedback === 'won'} onChange={(event) => { setNumberGuess(event.target.value); if (numberFeedback === 'error') setNumberFeedback('idle'); }} />
                <button className="number-guess-submit" type="submit" disabled={!numberGuess || numberFeedback === 'won'}>خمن</button>
              </form>
              <p className={`number-feedback ${numberFeedback}`} aria-live="polite">
                {numberFeedback === 'higher' ? 'الرقم السري أكبر، حاول مجدداً.' : numberFeedback === 'lower' ? 'الرقم السري أصغر، حاول مجدداً.' : numberFeedback === 'won' ? `أحسنت! وجدته خلال ${numberAttempts} محاولة.` : numberFeedback === 'error' ? (numberHistory.includes(Number(numberGuess)) ? 'جرّبت هذا الرقم من قبل، اختر رقماً آخر.' : 'اختر رقماً صحيحاً بين 1 و20.') : 'أدخل تخمينك وسأخبرك إن كان أعلى أو أقل.'}
              </p>
            </div>
          </div>
          <div className="number-history" aria-label="الأرقام التي جربتها">
            <span className="number-history-label">تخميناتك</span>
            {numberHistory.length ? numberHistory.map((guess) => <span className="number-history-chip" key={guess}>{guess}</span>) : <span className="number-history-empty">لم تجرّب رقماً بعد</span>}
          </div>
          <div className="games-footer"><span className="game-hint">جرّب أن تجد الرقم بأقل عدد من المحاولات</span><button className="game-action" onClick={resetNumberGame}><RotateCcw size={14} /> جولة جديدة</button></div>
        </section>
      </div>}
    </main>
    {activePdf && activePdfFile && <Suspense fallback={<div className="pdf-fullscreen-loading" role="status"><LoaderCircle size={24} /> جارٍ تجهيز قارئ PDF…</div>}><PdfReader key={activePdf.id} file={activePdfFile} name={activePdf.name} onClose={() => { setActivePdfFile(null); setActivePdf(null); }} /></Suspense>}
    <nav className="mobile-nav">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}><Icon size={18} /><span>{label}</span></button>)}</nav>
    {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><h2 id="modal-title">{modal === 'task' ? editingId ? 'تعديل المهمة' : 'مهمة جديدة' : editingId ? 'تعديل الملاحظة' : 'ملاحظة جديدة'}</h2><button className="small-icon" aria-label="إغلاق النافذة" onClick={() => setModal(null)}><X size={17} /></button></div>
      {modal === 'task' && <form onSubmit={saveTask}><div className="form-grid"><div className="form-field full"><label htmlFor="task-title">عنوان المهمة</label><input id="task-title" name="title" className="field" required defaultValue={tasks.find((task) => task.id === editingId)?.title || ''} placeholder="مثال: حل مسائل الفصل الثالث" /></div><div className="form-field"><label htmlFor="task-subject">المادة</label><select id="task-subject" name="subject" className="select-field" defaultValue={tasks.find((task) => task.id === editingId)?.subject || subjects[0]}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></div><div className="form-field"><label htmlFor="task-date">موعد الإنجاز</label><input id="task-date" name="dueDate" type="date" className="field" defaultValue={tasks.find((task) => task.id === editingId)?.dueDate || ''} /></div><div className="form-field full"><label htmlFor="task-priority">الأولوية</label><select id="task-priority" name="priority" className="select-field" defaultValue={tasks.find((task) => task.id === editingId)?.priority || 'متوسطة'}><option>عالية</option><option>متوسطة</option><option>منخفضة</option></select></div></div><div className="modal-actions"><button className="primary-btn" type="submit"><Check size={15} /> حفظ المهمة</button><button type="button" className="soft-btn" onClick={() => setModal(null)}>إلغاء</button></div></form>}
      {modal === 'note' && <form onSubmit={saveNote}><div className="form-grid"><div className="form-field full"><label htmlFor="note-title">عنوان الملاحظة</label><input id="note-title" name="title" className="field" required defaultValue={notes.find((note) => note.id === editingId)?.title || ''} placeholder="فكرة تستحق أن تبقى" /></div><div className="form-field full"><label htmlFor="note-subject">المادة</label><select id="note-subject" name="subject" className="select-field" defaultValue={notes.find((note) => note.id === editingId)?.subject || subjects[0]}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></div><div className="form-field full"><label htmlFor="note-content">محتوى الملاحظة</label><textarea id="note-content" name="content" className="text-field" defaultValue={notes.find((note) => note.id === editingId)?.content || ''} placeholder="اكتب شرحاً مختصراً، سؤالاً، أو أي شيء تريد تذكره..." /></div></div><div className="modal-actions"><button className="primary-btn" type="submit"><Check size={15} /> حفظ الملاحظة</button><button type="button" className="soft-btn" onClick={() => setModal(null)}>إلغاء</button></div></form>}
    </section></div>}
    {toast && <div className="toast-message" role="status">{toast}</div>}
  </div>;
}

function xoWinner(board: XoBoard): XoMark | null {
  const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  for (const [a, b, c] of lines) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return null;
}

function scoreXoBoard(board: XoBoard, turn: XoMark, depth: number): number {
  const winner = xoWinner(board);
  if (winner === 'O') return 10 - depth;
  if (winner === 'X') return depth - 10;
  const available = board.flatMap((mark, index) => mark === null ? [index] : []);
  if (!available.length) return 0;

  if (turn === 'O') {
    return Math.max(...available.map((index) => {
      const next = [...board];
      next[index] = 'O';
      return scoreXoBoard(next, 'X', depth + 1);
    }));
  }
  return Math.min(...available.map((index) => {
    const next = [...board];
    next[index] = 'X';
    return scoreXoBoard(next, 'O', depth + 1);
  }));
}

function chooseXoMove(board: XoBoard): number {
  let bestScore = Number.NEGATIVE_INFINITY;
  const bestMoves: number[] = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== null) continue;
    const next = [...board];
    next[index] = 'O';
    const score = scoreXoBoard(next, 'X', 0);
    if (score > bestScore) {
      bestScore = score;
      bestMoves.length = 0;
      bestMoves.push(index);
    } else if (score === bestScore) {
      bestMoves.push(index);
    }
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)] ?? -1;
}

export default App;
