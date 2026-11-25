import { useEffect, useMemo, useRef, useState } from "react";
import toast, { Toaster } from 'react-hot-toast'
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
const SCHEDULE_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function formatScheduleTimeBlock(timeBlock, blocks = []) {
  return blocks.find((block) => block.timeBlock === timeBlock)?.label || timeBlock || 'Unassigned'
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  const responseText = await response.text()

  let data = null

  try {
    data = responseText ? JSON.parse(responseText) : null
  } catch {
    data = responseText
  }

  if (!response.ok) {
    const errorMessage =
      data?.message ||
      data?.title ||
      data ||
      `${response.status} ${response.statusText}`

    throw new Error(errorMessage)
  }

  return data
}

function getConflictComparisonKey(item) {
  const conflict = typeof item === 'string' ? { message: item } : item
  const rawCourses = conflict.affectedCourseCodes?.length
    ? conflict.affectedCourseCodes
    : [conflict.courseCode, conflict.conflictingCourseCode].filter(Boolean)
  const courseCodes = (Array.isArray(rawCourses) ? rawCourses : [rawCourses])
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .sort()
  return `${conflict.code || conflict.category || 'conflict'}|${courseCodes.join(',')}|${courseCodes.length ? '' : (conflict.message || '').toLowerCase()}`
}

function getAffectedCourseCodes(item) {
  const conflict = typeof item === 'string' ? { courseCode: item } : item
  const rawCodes = conflict.affectedCourseCodes?.length
    ? conflict.affectedCourseCodes
    : [conflict.courseCode, conflict.conflictingCourseCode, conflict.relatedCourseCode].filter(Boolean)
  return (Array.isArray(rawCodes) ? rawCodes : [rawCodes])
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function csvCell(value) {
  let text = String(value ?? '')
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

function getConflictExplanation(conflict) {
  const explanations = {
    INSTRUCTOR_UNASSIGNED: 'No instructor is assigned to this course. Choose an instructor before saving the schedule.',
    INSTRUCTOR_UNQUALIFIED: 'The selected instructor is not listed as qualified to teach this course.',
    INSTRUCTOR_UNAVAILABLE: 'The selected time is outside this instructor’s available teaching blocks.',
    INSTRUCTOR_OVERLAP: 'The same instructor is assigned to multiple courses at the same time.',
    INSTRUCTOR_MAX_LOAD: 'The instructor has more assigned courses than their maximum course load.',
    ROOM_UNASSIGNED: 'No room is assigned. Select a room that meets the course requirements.',
    ROOM_CAPACITY: 'The room has fewer seats than the course’s predicted enrollment.',
    ROOM_TYPE_MISMATCH: 'This course requires a laboratory room, but the selected room is not a lab.',
    ROOM_EQUIPMENT_MISSING: 'The selected room does not have all equipment required by the course.',
    ROOM_UNAVAILABLE: 'The room is not available during the selected day and time block.',
    ROOM_OVERLAP: 'The same room is assigned to multiple courses at the same time.',
    INVALID_TIME_BLOCK: 'The selected time is not enabled for this semester and course type.',
  }
  return explanations[conflict.code] || `This assignment does not meet the ${conflict.category || 'scheduling'} rule. Review the details and suggested action below.`
}

function compareDraftAssignments(draftA, draftB) {
  const sectionsA = new Map((draftA.sections || []).map((section) => [section.courseCode.toLowerCase(), section]))
  const sectionsB = new Map((draftB.sections || []).map((section) => [section.courseCode.toLowerCase(), section]))
  const changes = []

  for (const [courseKey, sectionA] of sectionsA) {
    const sectionB = sectionsB.get(courseKey)
    if (!sectionB) {
      changes.push({ courseCode: sectionA.courseCode, type: 'Course removed', from: 'Included in Draft A', to: 'Not in Draft B' })
      continue
    }
    const timeA = `${sectionA.day || 'Unassigned'} · ${sectionA.timeBlock || 'Unassigned'}`
    const timeB = `${sectionB.day || 'Unassigned'} · ${sectionB.timeBlock || 'Unassigned'}`
    if (timeA !== timeB) changes.push({ courseCode: sectionA.courseCode, type: 'Course time changed', from: timeA, to: timeB })
    const instructorA = sectionA.instructorId || sectionA.instructorName || 'Unassigned'
    const instructorB = sectionB.instructorId || sectionB.instructorName || 'Unassigned'
    if (instructorA !== instructorB) changes.push({ courseCode: sectionA.courseCode, type: 'Instructor changed', from: sectionA.instructorName || 'Unassigned', to: sectionB.instructorName || 'Unassigned' })
    const roomA = sectionA.roomId || sectionA.roomNumber || 'Unassigned'
    const roomB = sectionB.roomId || sectionB.roomNumber || 'Unassigned'
    if (roomA !== roomB) changes.push({ courseCode: sectionA.courseCode, type: 'Room changed', from: sectionA.roomNumber || 'Unassigned', to: sectionB.roomNumber || 'Unassigned' })
  }

  for (const [courseKey, sectionB] of sectionsB) {
    if (!sectionsA.has(courseKey)) changes.push({ courseCode: sectionB.courseCode, type: 'Course added', from: 'Not in Draft A', to: 'Included in Draft B' })
  }
  return changes
}

function Stat({ label, value, danger }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={danger ? "danger-text" : ""}>{value}</strong>
    </div>
  );
}

function WorkflowProgress({ activeStep, completedSteps, onSelect }) {
  const steps = [
    ['planning', 'Plan inputs', 'Review courses and constraints'],
    ['schedule', 'Build schedule', 'Generate and edit assignments'],
    ['conflicts', 'Review conflicts', 'Validate required rules'],
    ['saved', 'Save draft', 'Keep a schedule version'],
  ]

  return (
    <nav className="workflow-progress" aria-label="Schedule workflow">
      {steps.map(([key, title, description], index) => {
        const complete = completedSteps.includes(key)
        const active = activeStep === key
        return (
          <button
            className={`workflow-step${active ? ' active' : ''}${complete ? ' complete' : ''}`}
            key={key}
            onClick={() => onSelect(key)}
            aria-current={active ? 'step' : undefined}
          >
            <span className="workflow-marker" aria-hidden="true">{complete ? '✓' : index + 1}</span>
            <span className="workflow-copy">
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
          </button>
        )
      })}
    </nav>
  )
}

function ResourceTable({ title, description, headers, rows }) {
  return (
    <section className="panel resource-panel">
      <div className="panel-title">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="resource-count">{rows.length} record(s)</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header} scope="col">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={index}>
                  {row.map((value, cellIndex) => (
                    <td key={cellIndex}>{value || "—"}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={headers.length} className="empty">
                  No data available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function App() {
  const [semester, setSemester] = useState("Fall 2026");
  const [semesterInput, setSemesterInput] = useState("Fall 2026");
  const [selectedOfferingIds, setSelectedOfferingIds] = useState([]);
  const [workspace, setWorkspace] = useState({
    offerings: [],
    instructors: [],
    rooms: [],
    constraints: [],
    scheduleBlocks: [],
  });
  const [draft, setDraft] = useState(null);
  const [validationStatus, setValidationStatus] = useState('pending');
  const [savedDraftId, setSavedDraftId] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [scheduleFilters, setScheduleFilters] = useState({ courseCode: '', instructorId: '', roomId: '', day: '', timeBlock: '', type: '', status: '' });
  const [view, setView] = useState(() => {
    const requestedView = window.location.hash.slice(1)
    return ['planning', 'schedule', 'conflicts', 'saved', 'print'].includes(requestedView) ? requestedView : 'planning'
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [instructorSearch, setInstructorSearch] = useState("");
  const [roomSearch, setRoomSearch] = useState("");
  const [constraintSearch, setConstraintSearch] = useState("");
  const [savedDraftSearch, setSavedDraftSearch] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [scheduleBlockDraft, setScheduleBlockDraft] = useState([]);
  const [savingScheduleBlocks, setSavingScheduleBlocks] = useState(false);
  const [instructorAvailabilityDraft, setInstructorAvailabilityDraft] = useState({});
  const [savingInstructorAvailabilityId, setSavingInstructorAvailabilityId] = useState(null);
  const [importFiles, setImportFiles] = useState([]);
  const [importPreview, setImportPreview] = useState(null);
  const [importSummary, setImportSummary] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importConfirming, setImportConfirming] = useState(false);
  const [validationLoading, setValidationLoading] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [planningTab, setPlanningTab] = useState("offerings");
  const [savedDrafts, setSavedDrafts] = useState([]);
  const [historyDraftId, setHistoryDraftId] = useState('');
  const [draftVersions, setDraftVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState(null);
  const [compareDraftAId, setCompareDraftAId] = useState('');
  const [compareDraftBId, setCompareDraftBId] = useState('');
  const [draftComparison, setDraftComparison] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [editingSection, setEditingSection] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const editDialogRef = useRef(null);
  const confirmationDialogRef = useRef(null);
  const confirmationCancelRef = useRef(null);
  const mobileNavToggleRef = useRef(null);
  const pageTitleRef = useRef(null);
  const modalReturnFocusRef = useRef(null);
  const modalWasOpenRef = useRef(false);
  const draftsRequestRef = useRef(false);
  const closeEditModalRef = useRef(() => {});
  const [deletingDraftId, setDeletingDraftId] = useState(null);
  const [duplicatingDraftId, setDuplicatingDraftId] = useState(null);
  const [editingConflicts, setEditingConflicts] = useState([]);
  const [editForm, setEditForm] = useState({
    instructorId: "",
    roomId: "",
    day: "Monday",
    timeBlock: "09:00-10:15",
  });

  function navigateToView(nextView) {
    if (!['planning', 'schedule', 'conflicts', 'saved', 'print'].includes(nextView)) return
    const cameFromMobileMenu = mobileNavOpen && window.matchMedia('(max-width: 700px)').matches
    setMobileNavOpen(false)
    if (nextView === view) {
      if (cameFromMobileMenu) pageTitleRef.current?.focus({ preventScroll: true })
      return
    }
    window.history.pushState({ view: nextView }, '', `#${nextView}`)
    setView(nextView)
    if (cameFromMobileMenu) pageTitleRef.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    const syncViewFromHistory = () => {
      const requestedView = window.location.hash.slice(1)
      setView(['planning', 'schedule', 'conflicts', 'saved', 'print'].includes(requestedView) ? requestedView : 'planning')
      setMobileNavOpen(false)
    }
    window.addEventListener('popstate', syncViewFromHistory)
    return () => window.removeEventListener('popstate', syncViewFromHistory)
  }, [])

  useEffect(() => {
    if (!mobileNavOpen) return undefined
    const closeMenuOnEscape = (event) => {
      if (event.key === 'Escape') {
        setMobileNavOpen(false)
        mobileNavToggleRef.current?.focus()
      }
    }
    window.addEventListener('keydown', closeMenuOnEscape)
    return () => window.removeEventListener('keydown', closeMenuOnEscape)
  }, [mobileNavOpen])

  async function loadWorkspace() {
    setWorkspaceLoading(true);
    try {
      // The workspace endpoint includes enabled constraints for planning. Fetch
      // the full list separately so users can also see and re-enable disabled rules.
      const [nextWorkspace, constraints] = await Promise.all([
        request(`/api/planning/workspace/${encodeURIComponent(semester)}`),
        request('/api/constraints'),
      ])
      setWorkspace({ ...nextWorkspace, constraints })
      setConnected(true);
      setMessage(`Planning data loaded for ${semester}.`);
    } catch (error) {
      setConnected(false);
      setMessage(`Backend connection failed: ${error.message}`);
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function saveScheduleBlocks() {
    setSavingScheduleBlocks(true)
    try {
      const configuration = await request(`/api/planning/blocks/${encodeURIComponent(semester)}`, {
        method: 'PUT',
        body: JSON.stringify({ blocks: scheduleBlockDraft }),
      })
      setWorkspace((current) => ({ ...current, scheduleBlocks: configuration.blocks || [] }))
      toast.success(`Approved blocks saved for ${semester}.`)
    } catch (error) {
      toast.error(`Could not save scheduling blocks: ${error.message}`)
    } finally {
      setSavingScheduleBlocks(false)
    }
  }

  function updateScheduleBlock(timeBlock, update) {
    setScheduleBlockDraft((current) => current.map((block) => block.timeBlock === timeBlock ? update(block) : block))
  }

  function toggleInstructorAvailability(instructorId, selection) {
    setInstructorAvailabilityDraft((current) => {
      const selected = current[instructorId] || []
      return { ...current, [instructorId]: selected.includes(selection) ? selected.filter((item) => item !== selection) : [...selected, selection] }
    })
  }

  async function saveInstructorAvailability(instructor) {
    const instructorId = instructor.id || instructor._id
    const availableBlocks = instructorAvailabilityDraft[instructorId] || []
    if (!availableBlocks.length) {
      toast.error('Select at least one available day and block before saving.')
      return
    }
    setSavingInstructorAvailabilityId(instructorId)
    try {
      const saved = await request(`/api/planning/instructors/${encodeURIComponent(instructorId)}/availability/${encodeURIComponent(semester)}`, {
        method: 'PUT',
        body: JSON.stringify({ availableBlocks }),
      })
      setWorkspace((current) => ({
        ...current,
        instructors: current.instructors.map((item) => (item.id || item._id) === instructorId ? { ...item, semesterAvailableBlocks: saved.availableBlocks } : item),
      }))
      toast.success(`${instructor.name || 'Instructor'} availability saved for ${semester}.`)
    } catch (error) {
      toast.error(`Could not save instructor availability: ${error.message}`)
    } finally {
      setSavingInstructorAvailabilityId(null)
    }
  }

  async function previewScheduleImport() {
    if (!importFiles.length) {
      toast.error('Choose one Excel workbook or one or more CSV files first.')
      return
    }
    const formData = new FormData()
    formData.append('semester', semester)
    importFiles.forEach((file) => formData.append('files', file))
    setImportLoading(true)
    setImportSummary(null)
    try {
      const response = await fetch(`${API_BASE}/api/planning/import/preview`, { method: 'POST', body: formData })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.message || 'Unable to read the selected import files.')
      setImportPreview(result)
    } catch (error) {
      toast.error(`Could not preview import: ${error.message}`)
    } finally {
      setImportLoading(false)
    }
  }

  async function confirmScheduleImport() {
    if (!importPreview?.canConfirm) return
    setImportConfirming(true)
    try {
      const result = await request('/api/planning/import/confirm', {
        method: 'POST',
        body: JSON.stringify(importPreview.batch),
      })
      setImportSummary({ ...result, warnings: importPreview.warnings || [], errors: [...(importPreview.errors || []), ...(result.errors || [])] })
      setImportPreview(null)
      setImportFiles([])
      toast.success('Valid scheduling data was imported.')
      await loadWorkspace()
    } catch (error) {
      toast.error(`Could not confirm import: ${error.message}`)
    } finally {
      setImportConfirming(false)
    }
  }

  function downloadImportCsvTemplate(kind) {
    const templates = {
      Courses: {
        headers: ['CourseCode', 'CourseTitle', 'Credits', 'HistoricalEnrollment', 'PredictedEnrollment', 'RequiresLab', 'RequiredEquipment', 'CrossListedWith', 'CoLocationGroup', 'InstructorName', 'RoomNumber'],
        row: ['CSI 501', 'Algorithms', '3', '40', '42', 'false', 'Projector', '', '', '', ''],
      },
      Instructors: {
        headers: ['Name', 'QualifiedCourses', 'PreferredCourses', 'MaximumCourseLoad', 'PrefersBackToBack'],
        row: ['Dr. Jordan Lee', 'CSI 501; CSI 502', 'CSI 501', '3', 'false'],
      },
      Rooms: {
        headers: ['RoomNumber', 'Building', 'Capacity', 'RoomType', 'Equipment'],
        row: ['D-101', 'Draper', '48', 'Lecture', 'Projector; Whiteboard'],
      },
      InstructorAvailability: {
        headers: ['InstructorName', 'Day', 'TimeBlock'],
        row: ['Dr. Jordan Lee', 'Monday', '09:20-10:10'],
      },
      RoomAvailability: {
        headers: ['RoomNumber', 'Day', 'TimeBlock'],
        row: ['D-101', 'Monday', '09:20-10:10'],
      },
    }
    const template = templates[kind]
    const quote = (value) => `"${String(value).replaceAll('"', '""')}"`
    const content = [template.headers, template.row].map((row) => row.map(quote).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${kind.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}-template.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function toggleConstraint(item) {
    const id = item.id || item._id
    if (!id) {
      toast.error('This rule cannot be updated because it has no ID.')
      return
    }

    const updated = { ...item, id, enabled: !(item.enabled === true || item.enabled === 'true' || item.enabled === 1) }
    try {
      await request(`/api/constraints/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(updated),
      })
      setWorkspace((current) => ({
        ...current,
        constraints: current.constraints.map((constraint) =>
          (constraint.id || constraint._id) === id ? updated : constraint,
        ),
      }))
      toast.success(`${updated.name || 'Rule'} ${updated.enabled ? 'enabled' : 'disabled'}.`)
    } catch (error) {
      toast.error(`Could not update rule: ${error.message}`)
    }
  }
  useEffect(() => {
    loadWorkspace();
  }, [semester]);

  useEffect(() => setSemesterInput(semester), [semester]);

  function commitSemesterInput() {
    const nextSemester = semesterInput.trim()
    if (!nextSemester) {
      setSemesterInput(semester)
      return
    }
    if (nextSemester !== semester) {
      setSelectedOfferingIds([])
      setSemester(nextSemester)
    }
  }

  useEffect(() => {
    if (Array.isArray(workspace.scheduleBlocks)) setScheduleBlockDraft(workspace.scheduleBlocks)
  }, [workspace.scheduleBlocks]);

  useEffect(() => {
    setInstructorAvailabilityDraft(Object.fromEntries(workspace.instructors.map((item) => [
      item.id || item._id,
      item.semesterAvailableBlocks ?? item.availableBlocks ?? [],
    ]).filter(([id]) => id)))
  }, [workspace.instructors]);

  useEffect(() => {
    if (!draft || savedDraftId) return undefined
    const warnBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [draft, savedDraftId])

  useEffect(() => {
    const dialog = confirmation ? confirmationDialogRef.current : editingSection ? editDialogRef.current : null
    if (!dialog) {
      if (modalWasOpenRef.current) {
        modalWasOpenRef.current = false
        if (modalReturnFocusRef.current?.isConnected) modalReturnFocusRef.current.focus()
        modalReturnFocusRef.current = null
      }
      return undefined
    }

    if (!modalWasOpenRef.current) modalReturnFocusRef.current = document.activeElement
    modalWasOpenRef.current = true
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusable = [...dialog.querySelectorAll(focusableSelector)]
    const initialFocus = confirmation ? confirmationCancelRef.current : focusable[0]
    ;(initialFocus || dialog).focus()

    function keepFocusInDialog(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (confirmation) setConfirmation(null)
        else closeEditModalRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const currentFocusable = [...dialog.querySelectorAll(focusableSelector)]
      if (!currentFocusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = currentFocusable[0]
      const last = currentFocusable[currentFocusable.length - 1]
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keepFocusInDialog)
    return () => document.removeEventListener('keydown', keepFocusInDialog)
  }, [confirmation, editingSection])

  async function loadDrafts(force = false) {
    if (draftsRequestRef.current || (draftsLoaded && !force)) return
    draftsRequestRef.current = true
    setDraftsLoading(true)
    try {
      setSavedDrafts(await request("/api/schedules/drafts"));
      setDraftsLoaded(true)
    } catch (error) {
      setMessage(`Could not load saved drafts: ${error.message}`);
    } finally {
      setDraftsLoading(false)
      draftsRequestRef.current = false
    }
  }

  useEffect(() => {
    if (view === 'saved') loadDrafts()
    if (view !== 'print') {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'instant' : 'smooth' })
    }
  }, [view])

  function closeEditModal() {
    if (loading) return
    const changed = editingSection && (
      (editForm.instructorId || '') !== (editingSection.instructorId || '') ||
      (editForm.roomId || '') !== (editingSection.roomId || '') ||
      (editForm.day || '') !== (editingSection.day || '') ||
      (editForm.timeBlock || '') !== (editingSection.timeBlock || '')
    )
    if (changed) {
      setConfirmation({ kind: 'discardEdit' })
      return
    }
    setEditingSection(null)
  }
  closeEditModalRef.current = closeEditModal

  async function saveDraft() {
    if (!draft) {
      toast.error('There is no draft to save.')
      return
    }

    const toastId = toast.loading('Saving draft...')

    try {
      const saved = await request('/api/schedules/drafts', {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          name: draft.name || `${semester} Schedule Draft`,
        }),
      })

      setDraft(saved)
      setSavedDraftId(saved.id || saved._id || true)
      await loadDrafts(true)

      toast.dismiss(toastId)
      toast.success('Draft saved successfully.')
    } catch (error) {
      toast.dismiss(toastId)
      toast.error(`Could not save draft: ${error.message}`)
    }
  }

  async function openDraft(id, skipUnsavedConfirmation = false) {
    if (draft && !savedDraftId && !skipUnsavedConfirmation && (draft.id || draft._id) !== id) {
      setConfirmation({ kind: 'openAnotherDraft', id })
      return
    }
    try {
      const openedDraft = await request(`/api/schedules/drafts/${id}`)
      setDraft(openedDraft)
      setSavedDraftId(id)
      setValidationStatus('pending')
      setConflicts([])
      setScheduleFilters({ courseCode: '', instructorId: '', roomId: '', day: '', timeBlock: '', type: '', status: '' })
      navigateToView("schedule");
      setMessage("Saved draft opened.");
      try {
        setValidationLoading(true)
        const validation = await request('/api/schedules/validate', { method: 'POST', body: JSON.stringify({ draft: openedDraft }) })
        setConflicts(validation.errors || [])
        setValidationStatus(validation.isValid ? 'valid' : 'issues')
      } catch {
        setMessage('Draft opened, but validation could not be loaded.')
      } finally {
        setValidationLoading(false)
      }
    } catch (error) {
      setMessage(`Could not open draft: ${error.message}`);
    }
  }

  async function deleteDraft(item) {
    const id = item.id || item._id
    if (!id) {
      toast.error('This draft cannot be deleted because it has no ID.')
      return
    }
    setConfirmation({ kind: 'deleteDraft', item })
  }

  async function duplicateDraft(item) {
    const id = item.id || item._id
    if (!id) {
      toast.error('This draft cannot be duplicated because it has no ID.')
      return
    }
    setDuplicatingDraftId(id)
    try {
      const duplicate = await request(`/api/schedules/drafts/${encodeURIComponent(id)}/duplicate`, { method: 'POST' })
      setSavedDrafts((current) => [duplicate, ...current])
      toast.success('Draft duplicated.')
    } catch (error) {
      toast.error(`Could not duplicate draft: ${error.message}`)
    } finally {
      setDuplicatingDraftId(null)
    }
  }

  async function loadDraftVersions(draftId) {
    setHistoryDraftId(draftId)
    setDraftVersions([])
    setVersionsLoading(true)
    try {
      setDraftVersions(await request(`/api/schedules/drafts/${encodeURIComponent(draftId)}/versions`))
    } catch (error) {
      toast.error(`Could not load draft history: ${error.message}`)
    } finally {
      setVersionsLoading(false)
    }
  }

  async function restoreDraftVersion(draftId, versionNumber) {
    setRestoringVersion(versionNumber)
    try {
      const restored = await request(`/api/schedules/drafts/${encodeURIComponent(draftId)}/versions/${versionNumber}/restore`, { method: 'POST' })
      setSavedDrafts((current) => current.map((item) => (item.id || item._id) === draftId ? restored : item))
      if ((draft?.id || draft?._id) === draftId) {
        setDraft(restored)
        setSavedDraftId(draftId)
        const validation = await request('/api/schedules/validate', { method: 'POST', body: JSON.stringify({ draft: restored }) })
        setConflicts(validation.errors || [])
        setValidationStatus(validation.isValid ? 'valid' : 'issues')
      }
      await loadDraftVersions(draftId)
      toast.success(`Version ${versionNumber} restored as version ${restored.versionNumber}.`)
    } catch (error) {
      toast.error(`Could not restore version: ${error.message}`)
    } finally {
      setRestoringVersion(null)
    }
  }

  async function compareDrafts() {
    if (!compareDraftAId || !compareDraftBId || compareDraftAId === compareDraftBId) {
      toast.error('Choose two different saved drafts to compare.')
      return
    }
    setComparisonLoading(true)
    setDraftComparison(null)
    try {
      const [draftA, draftB] = await Promise.all([
        request(`/api/schedules/drafts/${encodeURIComponent(compareDraftAId)}`),
        request(`/api/schedules/drafts/${encodeURIComponent(compareDraftBId)}`),
      ])
      const [validationA, validationB] = await Promise.all([
        request('/api/schedules/validate', { method: 'POST', body: JSON.stringify({ draft: draftA }) }),
        request('/api/schedules/validate', { method: 'POST', body: JSON.stringify({ draft: draftB }) }),
      ])
      const conflictsA = validationA.errors || []
      const conflictsB = validationB.errors || []
      const keysA = new Set(conflictsA.map(getConflictComparisonKey))
      const keysB = new Set(conflictsB.map(getConflictComparisonKey))
      setDraftComparison({
        draftA,
        draftB,
        assignmentChanges: compareDraftAssignments(draftA, draftB),
        addedConflicts: conflictsB.filter((item) => !keysA.has(getConflictComparisonKey(item))),
        resolvedConflicts: conflictsA.filter((item) => !keysB.has(getConflictComparisonKey(item))),
      })
      toast.success('Draft comparison is ready.')
    } catch (error) {
      toast.error(`Could not compare drafts: ${error.message}`)
    } finally {
      setComparisonLoading(false)
    }
  }

  async function confirmAction() {
    if (!confirmation) return
    if (confirmation.kind === 'discardEdit') {
      setConfirmation(null)
      setEditingSection(null)
      return
    }
    if (confirmation.kind === 'replaceDraft') {
      setConfirmation(null)
      await generateDraft(true)
      return
    }
    if (confirmation.kind === 'openAnotherDraft') {
      const { id } = confirmation
      setConfirmation(null)
      await openDraft(id, true)
      return
    }

    const item = confirmation.item
    const id = item?.id || item?._id
    if (!id) return
    setConfirmation(null)
    setDeletingDraftId(id)
    try {
      await request(`/api/schedules/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setSavedDrafts((current) => current.filter((saved) => (saved.id || saved._id) !== id))
      window.setTimeout(() => document.getElementById('saved-drafts-title')?.focus(), 0)
      if (historyDraftId === id) {
        setHistoryDraftId('')
        setDraftVersions([])
      }
      if (compareDraftAId === id) setCompareDraftAId('')
      if (compareDraftBId === id) setCompareDraftBId('')
      if (compareDraftAId === id || compareDraftBId === id) setDraftComparison(null)
      const openId = draft?.id || draft?._id
      if (openId === id) {
        setDraft(null)
        setSavedDraftId(null)
        setConflicts([])
        setValidationStatus('pending')
      }
      toast.success('Draft deleted.')
    } catch (error) {
      toast.error(`Could not delete draft: ${error.message}`)
    } finally {
      setDeletingDraftId(null)
    }
  }

  const offerings = useMemo(
    () =>
      workspace.offerings.filter((item) =>
        `${item.courseCode} ${item.courseTitle}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [workspace.offerings, search],
  );
  const allOfferingIds = workspace.offerings.map((item) => item.id || item._id).filter(Boolean).map(String)
  const allOfferingsSelected = allOfferingIds.length > 0 && allOfferingIds.every((id) => selectedOfferingIds.includes(id))

  function toggleOffering(id) {
    const normalizedId = String(id)
    setSelectedOfferingIds((current) => current.includes(normalizedId)
      ? current.filter((selectedId) => selectedId !== normalizedId)
      : [...current, normalizedId])
  }

  function selectAllOfferings() {
    setSelectedOfferingIds(allOfferingIds)
  }
  const filteredInstructors = useMemo(() => workspace.instructors.filter((item) => {
    const qualified = Array.isArray(item.qualifiedCourses) ? item.qualifiedCourses.join(' ') : (item.qualifiedCourses || '')
    const availability = item.semesterAvailableBlocks ?? item.availableBlocks
    const blocks = Array.isArray(availability) ? availability.join(' ') : (availability || '')
    return `${item.name || ''} ${qualified} ${blocks}`.toLowerCase().includes(instructorSearch.toLowerCase())
  }), [workspace.instructors, instructorSearch]);
  const filteredRooms = useMemo(() => workspace.rooms.filter((item) => {
    const searchableValues = [item.roomNumber, item.building, item.roomType, item.equipment, item.availableBlocks]
      .flatMap((value) => Array.isArray(value) ? value : [value || ''])
    return searchableValues.join(' ').toLowerCase().includes(roomSearch.toLowerCase())
  }), [workspace.rooms, roomSearch]);
  const filteredConstraints = useMemo(() => workspace.constraints.filter((item) => (
    `${item.name || ''} ${item.type || ''} ${item.priority || ''} ${item.description || ''} ${item.enabled === true || item.enabled === 'true' || item.enabled === 1 ? 'enabled active' : 'disabled inactive'}`
      .toLowerCase().includes(constraintSearch.toLowerCase())
  )), [workspace.constraints, constraintSearch]);
  const filteredSavedDrafts = useMemo(() => savedDrafts.filter((item) => (
    `${item.name || ''} ${item.semester || ''} ${item.status || ''} ${item.createdAtUtc || ''}`
      .toLowerCase().includes(savedDraftSearch.toLowerCase())
  )), [savedDrafts, savedDraftSearch]);
  const days = SCHEDULE_DAYS;
  const scheduleDays = [...days, 'Asynchronous'];
  const enabledInstructorBlocks = (workspace.scheduleBlocks || []).filter((block) => block.enabled && block.courseTypes?.length)
  const editCourseType = editingSection?.isLab ? 'Laboratory' : 'Lecture'
  const editAllowedBlocks = (workspace.scheduleBlocks || []).filter((block) => block.enabled && block.courseTypes?.includes(editCourseType))
  const scheduledCount = draft?.sections?.length || 0
  const assignedCount = draft?.sections?.filter((section) => section.instructorId && (section.roomId || section.timeBlock === 'ASYNC') && section.day && section.timeBlock).length || 0
  const conflictCourseCodes = useMemo(() => {
    const codes = new Set()
    for (const item of conflicts) {
      const conflict = typeof item === 'string' ? { courseCode: item } : item
      const values = conflict.affectedCourseCodes?.length
        ? conflict.affectedCourseCodes
        : [conflict.courseCode, conflict.conflictingCourseCode, conflict.relatedCourseCode].filter(Boolean)
      for (const value of (Array.isArray(values) ? values : [values])) {
        for (const code of String(value || '').split(',')) if (code.trim()) codes.add(code.trim().toLowerCase())
      }
    }
    return codes
  }, [conflicts])
  const filteredScheduleSections = useMemo(() => (draft?.sections || []).filter((section) => {
    const courseMatches = !scheduleFilters.courseCode || `${section.courseCode || ''}`.toLowerCase().includes(scheduleFilters.courseCode.toLowerCase())
    const instructorMatches = !scheduleFilters.instructorId || (scheduleFilters.instructorId === '__unassigned__' ? !section.instructorId : section.instructorId === scheduleFilters.instructorId)
    const roomMatches = !scheduleFilters.roomId || (scheduleFilters.roomId === '__unassigned__' ? !section.roomId : section.roomId === scheduleFilters.roomId)
    const dayMatches = !scheduleFilters.day || section.day === scheduleFilters.day
    const timeMatches = !scheduleFilters.timeBlock || (scheduleFilters.timeBlock === '__unassigned__' ? !section.timeBlock : section.timeBlock === scheduleFilters.timeBlock)
    const typeMatches = !scheduleFilters.type || (scheduleFilters.type === 'lab' ? section.isLab : !section.isLab)
    const hasConflict = conflictCourseCodes.has((section.courseCode || '').toLowerCase())
    const statusMatches = !scheduleFilters.status || (scheduleFilters.status === 'conflict' ? hasConflict : !hasConflict)
    return courseMatches && instructorMatches && roomMatches && dayMatches && timeMatches && typeMatches && statusMatches
  }), [draft?.sections, scheduleFilters, conflictCourseCodes])
  const scheduleInstructorOptions = [...new Map([
    ...workspace.instructors.map((item) => [item.id, { id: item.id, name: item.name }]),
    ...(draft?.sections || []).filter((section) => section.instructorId).map((section) => [section.instructorId, { id: section.instructorId, name: section.instructorName }]),
  ].filter(([id]) => id)).values()]
  const scheduleRoomOptions = [...new Map([
    ...workspace.rooms.map((item) => [item.id, { id: item.id, name: item.roomNumber }]),
    ...(draft?.sections || []).filter((section) => section.roomId).map((section) => [section.roomId, { id: section.roomId, name: section.roomNumber }]),
  ].filter(([id]) => id)).values()]
  const scheduleTimeOptions = [...new Set((draft?.sections || []).map((section) => section.timeBlock).filter(Boolean))].sort()
  const hasScheduleFilters = Object.values(scheduleFilters).some(Boolean)
  const scheduleUtilization = useMemo(() => {
    const sections = filteredScheduleSections
    const availableRoomSlots = workspace.rooms.reduce((total, room) => total + new Set(room.availableBlocks || []).size, 0)
    const occupiedRoomSlots = new Set(sections
      .filter((section) => section.roomId && section.day && section.timeBlock)
      .map((section) => `${section.roomId}|${section.day}|${section.timeBlock}`)).size
    const coursesPerDay = [...days, 'Asynchronous'].map((day) => ({ day, count: sections.filter((section) => section.day === day).length }))
    const periods = [...new Set(sections.map((section) => section.timeBlock).filter(Boolean))]
      .map((timeBlock) => ({ timeBlock, count: sections.filter((section) => section.timeBlock === timeBlock).length }))
      .sort((left, right) => right.count - left.count || left.timeBlock.localeCompare(right.timeBlock))
    const instructorDistribution = scheduleInstructorOptions.map((item) => {
      const assignments = sections.filter((section) => section.instructorId === item.id).length
      const instructor = workspace.instructors.find((resource) => resource.id === item.id)
      return { ...item, assignments, maximumLoad: instructor?.maximumCourseLoad ?? null }
    }).sort((left, right) => right.assignments - left.assignments || (left.name || '').localeCompare(right.name || ''))
    return {
      roomUtilization: availableRoomSlots ? Math.round(occupiedRoomSlots / availableRoomSlots * 100) : null,
      occupiedRoomSlots,
      availableRoomSlots,
      coursesPerDay,
      laboratoryCourses: sections.filter((section) => section.isLab).length,
      unassignedRooms: sections.filter((section) => !section.roomId && section.timeBlock !== 'ASYNC').length,
      unassignedInstructors: sections.filter((section) => !section.instructorId).length,
      periods,
      peakPeriod: periods[0] || null,
      instructorDistribution,
    }
  }, [filteredScheduleSections, workspace.rooms, workspace.instructors, days, scheduleInstructorOptions])
  const scheduleStatusLabel = validationStatus === 'valid' ? 'Valid' : validationStatus === 'issues' ? 'Needs Review' : (draft?.status || 'Not validated')
  const instructorWorkload = useMemo(() => workspace.instructors.map((instructor) => {
    const assignments = (draft?.sections || []).filter((section) => section.instructorId && section.instructorId === instructor.id)
    const maximumLoad = Number(instructor.maximumCourseLoad ?? 0)
    return { instructor, assignments, overloaded: assignments.length > maximumLoad }
  }), [workspace.instructors, draft?.sections])

  async function generateDraft(skipUnsavedConfirmation = false) {
    if (!selectedOfferingIds.length) {
      toast.error('Select at least one course offering to generate a draft.')
      return
    }
    if (draft && !savedDraftId && !skipUnsavedConfirmation) {
      setConfirmation({ kind: 'replaceDraft' })
      return
    }

    const toastId = toast.loading('Generating schedule draft...')
    const selectedCount = selectedOfferingIds.length

    try {
      setLoading(true)

      const generatedDraft = await request('/api/schedules/generate', {
        method: 'POST',
        body: JSON.stringify({
          semester,
          offeringIds: selectedOfferingIds,
        }),
      })

      setDraft(generatedDraft)
      setValidationStatus('pending')
      setSavedDraftId(null)
      setConflicts([])
      setScheduleFilters({ courseCode: '', instructorId: '', roomId: '', day: '', timeBlock: '', type: '', status: '' })
      navigateToView('schedule')

      try {
        const validation = await request('/api/schedules/validate', { method: 'POST', body: JSON.stringify({ draft: generatedDraft }) })
        setConflicts(validation.errors || [])
        setValidationStatus(validation.isValid ? 'valid' : 'issues')
      } catch {
        setMessage('Draft generated, but validation could not be loaded.')
      }

      toast.dismiss(toastId)
      toast.success(`Draft generated with ${selectedCount} selected ${selectedCount === 1 ? 'course' : 'courses'}.`)
    } catch (error) {
      toast.dismiss(toastId)
      toast.error(`Draft generation failed: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  async function validateDraft() {
    if (!draft) {
      toast.error('There is no draft to validate.')
      return
    }

    const toastId = toast.loading('Validating schedule...')
    setValidationLoading(true)

    try {
      const result = await request('/api/schedules/validate', {
        method: 'POST',
        body: JSON.stringify({ draft }),
      })

      setConflicts(result.errors || [])
      setValidationStatus(result.isValid ? 'valid' : 'issues')

      toast.dismiss(toastId)

      if (result.isValid) {
        toast.success('Schedule passed validation.')
        navigateToView('schedule')
      } else {
        toast.error(`${result.errors.length} conflict(s) found.`)
        navigateToView('conflicts')
      }
    } catch (error) {
      toast.dismiss(toastId)
      toast.error(`Validation failed: ${error.message}`)
    } finally {
      setValidationLoading(false)
    }
  }

  function exportCsv() {
    if (!draft) return
    const rows = [[
      'Semester', 'Draft name', 'Schedule status', 'Course', 'Instructor', 'Room', 'Day', 'Time', 'Conflict summary',
    ]]
    for (const section of draft.sections || []) {
      const sectionConflicts = conflicts.filter((item) => getAffectedCourseCodes(item).includes((section.courseCode || '').toLowerCase()))
      rows.push([
        draft.semester,
        draft.name,
        scheduleStatusLabel,
        section.courseCode,
        section.instructorName || 'Unassigned',
        section.roomNumber || 'Unassigned',
        section.day || 'Unassigned',
        section.timeBlock || 'Unassigned',
        sectionConflicts.map((item) => typeof item === 'string' ? item : item.message || item.category).join(' | ') || 'No conflicts',
      ])
    }
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${(draft.name || 'schedule').replace(/[^a-z0-9_-]+/gi, '-')}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success('Schedule exported as CSV.')
  }

  function openPrintView(exportPdf = false) {
    if (!draft) return
    navigateToView('print')
    if (exportPdf) window.setTimeout(() => window.print(), 250)
  }

  function getConflictQuickFixes(conflict, section) {
    if (!draft || !section) return []
    const sections = draft.sections || []
    const otherSections = sections.filter((item) => item.courseCode !== section.courseCode)
    const normalized = (value) => String(value || '').trim().toLowerCase()
    const availabilityMatches = (blocks, day, timeBlock) => {
      const values = Array.isArray(blocks) ? blocks : (blocks ? [blocks] : [])
      return values.some((block) => {
        const text = normalized(block)
        return text === normalized(`${day} ${timeBlock}`) || (text.includes(normalized(day)) && text.includes(normalized(timeBlock)))
      })
    }
    const requiredEquipment = Array.isArray(section.requiredEquipment) ? section.requiredEquipment : []
    const isRoomSuitable = (room) =>
      Number(room.capacity || 0) >= Number(section.predictedEnrollment || 0) &&
      (!section.isLab || /lab/i.test(room.roomType || '')) &&
      requiredEquipment.every((equipment) => (room.equipment || []).some((available) => normalized(available) === normalized(equipment)))
    const roomIsFree = (roomId, day, timeBlock) => !otherSections.some((item) => item.roomId === roomId && item.day === day && item.timeBlock === timeBlock)
    const instructorIsFree = (instructorId, day, timeBlock) => !otherSections.some((item) => item.instructorId === instructorId && item.day === day && item.timeBlock === timeBlock)
    const code = String(conflict.code || '').toUpperCase()
    const fixes = []

    const suitableRooms = workspace.rooms.filter((room) => isRoomSuitable(room) &&
      availabilityMatches(room.availableBlocks, section.day, section.timeBlock) && roomIsFree(room.id, section.day, section.timeBlock) && room.id !== section.roomId)
    for (const room of suitableRooms.slice(0, 2)) fixes.push({
      label: `Assign ${room.roomNumber}`,
      assignment: { roomId: room.id },
    })

    const qualifiedInstructors = workspace.instructors.filter((instructor) => {
      const qualifiedCourses = Array.isArray(instructor.qualifiedCourses) ? instructor.qualifiedCourses : [instructor.qualifiedCourses].filter(Boolean)
      const load = otherSections.filter((item) => item.instructorId === instructor.id).length
      return qualifiedCourses.some((course) => normalized(course) === normalized(section.courseCode)) &&
        availabilityMatches(instructor.semesterAvailableBlocks ?? instructor.availableBlocks, section.day, section.timeBlock) &&
        instructorIsFree(instructor.id, section.day, section.timeBlock) &&
        load < Number(instructor.maximumCourseLoad ?? Infinity) && instructor.id !== section.instructorId
    })
    for (const instructor of qualifiedInstructors.slice(0, 2)) fixes.push({
      label: `Assign ${instructor.name}`,
      assignment: { instructorId: instructor.id },
    })

    const courseType = section.isLab ? 'Laboratory' : 'Lecture'
    const candidateDays = SCHEDULE_DAYS
    const candidateTimes = (workspace.scheduleBlocks || []).filter((block) => block.enabled && block.courseTypes?.includes(courseType)).map((block) => block.timeBlock)
    for (const day of candidateDays) {
      for (const timeBlock of candidateTimes) {
        if (day === section.day && timeBlock === section.timeBlock) continue
        const assignedRoom = workspace.rooms.find((room) => room.id === section.roomId)
        const assignedInstructor = workspace.instructors.find((instructor) => instructor.id === section.instructorId)
        if (section.roomId && (!assignedRoom || !isRoomSuitable(assignedRoom) || !availabilityMatches(assignedRoom.availableBlocks, day, timeBlock) || !roomIsFree(section.roomId, day, timeBlock))) continue
        if (section.instructorId && (!assignedInstructor || !availabilityMatches(assignedInstructor.semesterAvailableBlocks ?? assignedInstructor.availableBlocks, day, timeBlock) || !instructorIsFree(section.instructorId, day, timeBlock))) continue
        const label = formatScheduleTimeBlock(timeBlock, workspace.scheduleBlocks)
        fixes.push({ label: `Move to ${day} ${label}`, assignment: { day, timeBlock } })
        if (fixes.length >= 5) break
      }
      if (fixes.length >= 5) break
    }

    const roomConflict = code.startsWith('ROOM_')
    const instructorConflict = code.startsWith('INSTRUCTOR_')
    const ranked = fixes.sort((left, right) => {
      const roomFirst = roomConflict ? left.assignment.roomId : instructorConflict ? left.assignment.instructorId : null
      const rightRoomFirst = roomConflict ? right.assignment.roomId : instructorConflict ? right.assignment.instructorId : null
      return Number(Boolean(rightRoomFirst)) - Number(Boolean(roomFirst))
    })
    return ranked.slice(0, 3)
  }

  function startEdit(section, suggestedAssignment = {}) {
    setEditingSection(section);
    setEditingConflicts([]);
    setEditForm({
      instructorId: suggestedAssignment.instructorId ?? section.instructorId ?? "",
      roomId: suggestedAssignment.roomId ?? section.roomId ?? "",
      day: suggestedAssignment.day ?? section.day ?? "Monday",
      timeBlock: suggestedAssignment.timeBlock ?? section.timeBlock ?? editAllowedBlocks[0]?.timeBlock ?? "",
    });
  }

  async function saveSectionEdit() {
    if (!draft || !editingSection) {
      toast.error('Please select an assignment first.')
      return
    }
    if (!editAllowedBlocks.some((block) => block.timeBlock === editForm.timeBlock)) {
      toast.error('Select an enabled university block for this course type before saving.')
      return
    }

    const toastId = toast.loading('Saving and validating assignment...')

    try {
      setLoading(true)

      const draftId = draft.id || draft._id

      if (!draftId) {
        throw new Error('Draft ID is missing.')
      }

      const result = await request(
        `/api/schedules/drafts/${draftId}/sections/${encodeURIComponent(
          editingSection.courseCode
        )}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            instructorId: editForm.instructorId || '',
            roomId: editForm.roomId || '',
            day: editForm.day,
            timeBlock: editForm.timeBlock,
          }),
        }
      )

      setDraft(result.draft)
      setSavedDraftId(result.draft.id || result.draft._id)
      setValidationStatus(result.isValid ? 'valid' : 'issues')
      setConflicts(result.errors || [])
      setEditingConflicts(result.isValid ? [] : (result.errors || []))

      toast.dismiss(toastId)

      if (result.isValid) {
        setEditingSection(null)
        toast.success('Assignment updated successfully.')
        navigateToView('schedule')
      } else {
        toast.error(`${result.errors?.length || 1} conflict(s) found. Review the warning and adjust this assignment.`)
      }
    } catch (error) {
      console.error('Save assignment error:', error)

      toast.dismiss(toastId)
      toast.error(error.message || 'Unable to save assignment.')
    } finally {
      setLoading(false)
    }
  }

  const editPanel = editingSection && (
      <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeEditModal() }}>
      <div
        className="edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-assignment-title"
        aria-describedby="edit-assignment-description"
        tabIndex={-1}
        ref={editDialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="edit-modal-header">
          <div>
            <span className="eyebrow">SCHEDULE ASSIGNMENT</span>
            <h2 id="edit-assignment-title">Edit {editingSection.courseCode}</h2>
            <p id="edit-assignment-description">Update the assignment and validate the change.</p>
          </div>

          <button
            className="modal-close"
            onClick={closeEditModal}
            disabled={loading}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="current-assignment" role="group" aria-label="Current assignment values">
          <strong>Current assignment</strong>
          <span><b>Instructor</b>{editingSection.instructorName || 'Unassigned'}</span>
          <span><b>Room</b>{editingSection.roomNumber || 'Unassigned'}</span>
          <span><b>Day</b>{editingSection.day || 'Unassigned'}</span>
          <span><b>Time</b>{formatScheduleTimeBlock(editingSection.timeBlock, workspace.scheduleBlocks)}</span>
        </div>

        {editingConflicts.length > 0 && (
          <div className="edit-conflict-warning" role="alert">
            <strong>⚠ This change creates a scheduling conflict</strong>
            {editingConflicts.map((item, index) => (
              <p key={index}>
                {typeof item === 'string' ? item : (item.message || item.category || 'Scheduling conflict')}
                {typeof item === 'object' && item.courseCode && ` with ${item.courseCode}`}
                {typeof item === 'object' && item.suggestedAction && ` ${item.suggestedAction}`}
              </p>
            ))}
            <small>Choose another room or time, then save and validate again.</small>
          </div>
        )}

        <div className="edit-fields">
          <label>
            Instructor
            <select
              value={editForm.instructorId}
              onChange={(event) =>
                setEditForm({
                  ...editForm,
                  instructorId: event.target.value,
                })
              }
            >
              <option value="">Unassigned</option>

              {workspace.instructors.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Room
            <select
              value={editForm.roomId}
              onChange={(event) =>
                setEditForm({
                  ...editForm,
                  roomId: event.target.value,
                })
              }
            >
              <option value="">Unassigned</option>

              {workspace.rooms.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.roomNumber} · {item.roomType || 'Room'} · Capacity {item.capacity}{item.equipment?.length ? ` · ${item.equipment.join(', ')}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            Day
            <select
              value={editForm.day}
              onChange={(event) => {
                const day = event.target.value
                const asyncBlock = editAllowedBlocks.find((block) => block.category === 'Asynchronous')
                const physicalBlock = editAllowedBlocks.find((block) => block.category !== 'Asynchronous')
                setEditForm({ ...editForm, day, timeBlock: day === 'Asynchronous' ? (asyncBlock?.timeBlock || editForm.timeBlock) : editForm.timeBlock === asyncBlock?.timeBlock ? (physicalBlock?.timeBlock || '') : editForm.timeBlock, roomId: day === 'Asynchronous' ? '' : editForm.roomId })
              }}
            >
              {days.map((day) => (
                <option value={day} key={day}>
                  {day}
                </option>
              ))}
              {editAllowedBlocks.some((block) => block.category === 'Asynchronous') && <option value="Asynchronous">Asynchronous</option>}
            </select>
          </label>

          <label>
            Time block
            <select
              value={editForm.timeBlock}
              onChange={(event) => {
                const timeBlock = event.target.value
                const selectedBlock = editAllowedBlocks.find((block) => block.timeBlock === timeBlock)
                const isAsync = selectedBlock?.category === 'Asynchronous'
                setEditForm({ ...editForm, timeBlock, day: isAsync ? 'Asynchronous' : editForm.day === 'Asynchronous' ? 'Monday' : editForm.day, roomId: isAsync ? '' : editForm.roomId })
              }}
            >
              {editingSection.timeBlock && !editAllowedBlocks.some((block) => block.timeBlock === editingSection.timeBlock) && (
                <option value={editingSection.timeBlock} disabled>{editingSection.timeBlock} · not approved</option>
              )}
              {['Normal', 'Evening', 'Asynchronous'].map((category) => {
                const blocks = editAllowedBlocks.filter((block) => block.category === category)
                return blocks.length ? (
                  <optgroup label={category === 'Normal' ? 'Daytime' : category} key={category}>
                    {blocks.map((block) => <option value={block.timeBlock} key={block.timeBlock}>{block.label}</option>)}
                  </optgroup>
                ) : null
              })}
            </select>
          </label>
        </div>

        <div className="modal-footer">
          <button
            className="secondary-button"
            onClick={closeEditModal}
            disabled={loading}
          >
            Cancel
          </button>

          <button
            className="primary"
            onClick={saveSectionEdit}
            disabled={loading}
          >
            {loading && <span className="button-spinner" aria-hidden="true" />}
            {loading ? 'Saving and validating…' : 'Save and validate'}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          style: {
            borderRadius: '10px',
            background: '#17324d',
            color: '#ffffff',
            fontSize: '13px',
          },
        }}
      />
      {confirmation && (
        <div className="modal-backdrop confirmation-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setConfirmation(null)
        }}>
          <section className={`confirmation-modal${confirmation.kind === 'deleteDraft' ? ' delete-confirmation' : confirmation.kind === 'discardEdit' ? '' : ' replace-confirmation'}`} ref={confirmationDialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-description">
            <div className="confirmation-heading">
              <span className="confirmation-icon" aria-hidden="true">
                {confirmation.kind === 'deleteDraft' ? (
                  <svg viewBox="0 0 24 24" focusable="false"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" /></svg>
                ) : confirmation.kind === 'discardEdit' ? '↶' : '↻'}
              </span>
              <div>
                <span className="confirmation-eyebrow">{confirmation.kind === 'deleteDraft' ? 'DELETE SAVED DRAFT' : confirmation.kind === 'discardEdit' ? 'UNSAVED ASSIGNMENT' : 'UNSAVED DRAFT'}</span>
                <h2 id="confirmation-title">{confirmation.kind === 'deleteDraft' ? 'Delete this draft?' : confirmation.kind === 'discardEdit' ? 'Discard unsaved changes?' : confirmation.kind === 'replaceDraft' ? 'Replace this draft?' : 'Open another draft?'}</h2>
              </div>
            </div>
            <p id="confirmation-description">
              {confirmation.kind === 'deleteDraft'
                ? 'This will permanently remove the saved schedule and its assignments.'
                : confirmation.kind === 'discardEdit'
                  ? 'Your assignment changes will be lost.'
                  : confirmation.kind === 'replaceDraft'
                    ? 'Generating a new schedule will replace the unsaved draft currently open.'
                    : 'Opening another saved draft will replace the unsaved draft currently open.'}
            </p>
            {confirmation.kind === 'deleteDraft' && (
              <div className="confirmation-draft-details">
                <span className="confirmation-draft-mark" aria-hidden="true">▤</span>
                <div>
                  <strong>{confirmation.item?.name || 'Untitled schedule draft'}</strong>
                  <span>{confirmation.item?.semester || 'Semester not specified'}</span>
                </div>
              </div>
            )}
            {confirmation.kind === 'deleteDraft' && <p className="confirmation-warning">This action can’t be undone.</p>}
            {(confirmation.kind === 'replaceDraft' || confirmation.kind === 'openAnotherDraft') && <p className="confirmation-warning">Save the current draft first if you want to keep these changes.</p>}
            <div className="confirmation-actions">
              <button ref={confirmationCancelRef} type="button" className="confirmation-cancel" onClick={() => setConfirmation(null)}>Cancel</button>
              <button type="button" className="confirmation-destructive" onClick={confirmAction}>
                {confirmation.kind === 'deleteDraft' ? 'Delete draft' : confirmation.kind === 'discardEdit' ? 'Discard changes' : confirmation.kind === 'replaceDraft' ? 'Replace draft' : 'Open draft'}
              </button>
            </div>
          </section>
        </div>
      )}
      <a className="skip-to-content" href="#main-content">Skip to main content</a>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <img src="/schedulespark-logo.svg" alt="ScheduleSpark" />
            <small>Academic scheduling workspace</small>
          </div>
          <button
            ref={mobileNavToggleRef}
            id="mobile-navigation-toggle"
            className="mobile-nav-toggle"
            type="button"
            aria-expanded={mobileNavOpen}
            aria-controls="workspace-navigation"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <span className={`hamburger-icon${mobileNavOpen ? ' is-open' : ''}`} aria-hidden="true"><i></i><i></i><i></i></span>
            <span>{mobileNavOpen ? 'Close menu' : 'Menu'}</span>
          </button>
          <nav
            id="workspace-navigation"
            className={mobileNavOpen ? 'is-open' : ''}
            aria-label="Workspace sections"
          >
            <button
              className={view === "planning" ? "active" : ""}
              aria-current={view === 'planning' ? 'page' : undefined}
              onClick={() => navigateToView("planning")}
            >
              ▦ <span>Planning Workspace</span>
            </button>
            <button
              className={view === "schedule" ? "active" : ""}
              aria-current={view === 'schedule' ? 'page' : undefined}
              onClick={() => navigateToView("schedule")}
            >
              ▤ <span>Schedule Builder</span>
            </button>
            <button
              className={view === "conflicts" ? "active" : ""}
              aria-current={view === 'conflicts' ? 'page' : undefined}
              onClick={() => navigateToView("conflicts")}
            >
              ⚠ <span>Conflict Review</span>
              {conflicts.length > 0 && <em>{conflicts.length}</em>}
            </button>
            <button
              className={view === "saved" ? "active" : ""}
              aria-current={view === 'saved' ? 'page' : undefined}
              onClick={() => {
                navigateToView("saved");
                loadDrafts();
              }}
            >
              ▣ <span>Saved Drafts</span>
            </button>
          </nav>
          <div className="connection">
            <i className={connected ? "online" : ""}></i>
            {connected ? "API connected" : "API not connected"}
            <small>Team D · Delta</small>
          </div>
        </aside>
        <main>
          {editPanel}
          <header>
            <div>
              <label className="eyebrow">ACADEMIC SCHEDULING</label>
              <h1 ref={pageTitleRef} tabIndex={-1}>
                {view === "planning"
                  ? "Planning Workspace"
                  : view === "schedule"
                    ? "Schedule Builder"
                    : view === "print"
                      ? "Print Schedule"
                    : view === "saved"
                      ? "Saved Drafts"
                      : "Conflict Review"}
              </h1>
              <p>
                Plan offerings, generate drafts, and resolve constraints in one
                place.
              </p>
            </div>
            <div className="controls">
              <label>
                Semester
                <input
                  list="semester-options"
                  value={semesterInput}
                  onChange={(event) => setSemesterInput(event.target.value)}
                  onBlur={commitSemesterInput}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                  aria-label="Semester. Choose a preset or type a future semester."
                />
                <datalist id="semester-options"><option value="Fall 2026" /><option value="Spring 2027" /><option value="Fall 2027" /><option value="Spring 2028" /></datalist>
              </label>
              <button onClick={loadWorkspace} disabled={workspaceLoading} aria-label="Refresh planning workspace">{workspaceLoading ? 'Loading…' : '↻ Refresh'}</button>
            </div>
          </header>
          {view !== 'print' && <WorkflowProgress
            activeStep={view}
            completedSteps={[
              ...(connected ? ['planning'] : []),
              ...(draft ? ['schedule'] : []),
              ...(validationStatus !== 'pending' ? ['conflicts'] : []),
              ...(savedDraftId ? ['saved'] : []),
            ]}
            onSelect={navigateToView}
          />}
          {view !== 'print' && <section className="stats">
            <Stat label="Course offerings" value={workspace.offerings.length} />
            <Stat label="Instructors" value={workspace.instructors.length} />
            <Stat label="Rooms and labs" value={workspace.rooms.length} />
            <Stat
              label="Open conflicts"
              value={conflicts.length}
              danger={conflicts.length > 0}
            />
          </section>}
          <div className="navigation-loading" aria-live="polite" aria-atomic="true">
            {workspaceLoading && <span><i className="loading-spinner" aria-hidden="true" /> Updating planning data…</span>}
          </div>
          <div id="main-content" key={view} className="view-transition" tabIndex={-1} aria-busy={workspaceLoading}>
          {view === "planning" && (
            <>
              <div className="planning-tabs" role="group" aria-label="Planning data sections">
                {[
                  ["offerings", "Course Offerings"],
                  ["instructors", "Instructors"],
                  ["rooms", "Rooms & Labs"],
                  ["constraints", "Constraints"],
                  ["timeblocks", "University Blocks"],
                  ["import", "Import Data"],
                ].map(([key, label]) => (
                  <button
                    className={planningTab === key ? "selected" : ""}
                    aria-pressed={planningTab === key}
                    onClick={() => setPlanningTab(key)}
                    key={key}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {planningTab === "offerings" && (
                <section className="grid">
                  <div className="panel wide">
                    <div className="panel-title">
                      <div>
                        <h2>Semester planning data</h2>
                        <p>
                          Course catalog information is read-only reference data.
                        </p>
                      </div>
                      <button
                        className="primary"
                        onClick={() => generateDraft()}
                        disabled={loading || selectedOfferingIds.length === 0}
                        aria-busy={loading}
                      >
                        {loading && <span className="inline-spinner" aria-hidden="true" />}
                        {loading ? 'Generating schedule…' : `✦ Generate selected draft (${selectedOfferingIds.length})`}
                      </button>
                    </div>
                    <div className="toolbar">
                      <input
                        aria-label="Search course offerings by code or title"
                        placeholder="Search by course code or title"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <div className="offering-selection-summary">
                        <span><strong>{selectedOfferingIds.length}</strong> selected · {offerings.length} shown</span>
                        <div className="offering-selection-actions">
                          <button type="button" onClick={selectAllOfferings} disabled={!allOfferingIds.length || allOfferingsSelected}>Select all</button>
                          <button type="button" onClick={() => setSelectedOfferingIds([])} disabled={!selectedOfferingIds.length}>Clear selection</button>
                        </div>
                      </div>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th scope="col" className="offering-select-column">Select</th>
                          <th scope="col">Course</th>
                          <th scope="col">Title</th>
                          <th scope="col">Predicted enrollment</th>
                          <th scope="col">Type</th>
                          <th scope="col">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workspaceLoading ? (
                          <tr><td colSpan="6" className="empty" role="status" aria-live="polite">Loading course offerings…</td></tr>
                        ) : offerings.length ? (
                          offerings.map((item) => (
                            <tr key={item.id || item._id} className={selectedOfferingIds.includes(String(item.id || item._id)) ? 'offering-selected' : ''}>
                              <td className="offering-select-column">
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${item.courseCode} — ${item.courseTitle}`}
                                  checked={selectedOfferingIds.includes(String(item.id || item._id))}
                                  onChange={() => toggleOffering(item.id || item._id)}
                                  disabled={!item.id && !item._id}
                                />
                              </td>
                              <td>
                                <b>{item.courseCode}</b>
                              </td>
                              <td>{item.courseTitle}</td>
                              <td>{item.predictedEnrollment}</td>
                              <td>
                                {item.requiresLab ? "Laboratory" : "Lecture"}
                              </td>
                              <td>
                                <span className="ready">Ready</span>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="6" className="empty">
                              No course offerings found for {semester}.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="panel">
                    <h2>Readiness</h2>
                    <p>Inputs required for generation</p>
                    {[
                      ["Offerings", workspace.offerings.length],
                      ["Instructor availability", workspace.instructors.length],
                      ["Rooms and laboratories", workspace.rooms.length],
                      ["Required constraints", workspace.constraints.length],
                    ].map(([label, count]) => (
                      <div className="readiness" key={label}>
                        <span>{label}</span>
                        <b className={count ? "green" : ""}>
                          {count ? "Ready" : "Missing"}
                        </b>
                      </div>
                    ))}
                    <div className="tip">
                      <b>Planning tip</b>
                      <p>Complete required inputs before generating a draft.</p>
                    </div>
                  </div>
                </section>
              )}
              {planningTab === "instructors" && (
                <section className="panel instructor-panel">
                  <div className="instructor-header">
                    <div>
                      <span className="eyebrow">TEACHING RESOURCES</span>
                      <h2>Instructor availability</h2>
                      <p>Compare course qualifications, available teaching blocks, and workload limits.</p>
                    </div>
                    <span className="instructor-total">{filteredInstructors.length} <small>of {workspace.instructors.length} instructors</small></span>
                  </div>
                  <div className="instructor-toolbar">
                    <label className="instructor-search">
                      <span aria-hidden="true">⌕</span>
                      <input aria-label="Search instructors, courses, or availability" placeholder="Search name, course, or time block" value={instructorSearch} onChange={(event) => setInstructorSearch(event.target.value)} />
                    </label>
                    <span>Use these details to match teaching assignments.</span>
                  </div>
                  {workspaceLoading ? (
                    <div className="instructor-empty" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true" /><h3>Loading instructor availability…</h3></div>
                  ) : filteredInstructors.length ? (
                    <div className="instructor-grid">
                      {filteredInstructors.map((item) => {
                        const instructorId = item.id || item._id
                        const qualifiedCourses = Array.isArray(item.qualifiedCourses) ? item.qualifiedCourses : (item.qualifiedCourses ? [item.qualifiedCourses] : [])
                        const availableBlocks = instructorAvailabilityDraft[instructorId] || []
                        const initials = (item.name || 'Instructor').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
                        return (
                          <article className="instructor-card" key={item.id || item.name}>
                            <div className="instructor-card-head">
                              <span className="instructor-avatar" aria-hidden="true">{initials}</span>
                              <div className="instructor-identity"><h3>{item.name || 'Unnamed instructor'}</h3><span>Instructor</span></div>
                              <div className="load-badge"><strong>{item.maximumCourseLoad ?? '—'}</strong><small>max courses</small></div>
                            </div>
                            <div className="instructor-card-section">
                              <span className="instructor-section-label">QUALIFIED COURSES</span>
                              {qualifiedCourses.length ? <div className="instructor-tags">{qualifiedCourses.map((course) => <span className="instructor-tag" key={course}>{course}</span>)}</div> : <p className="instructor-missing">No course qualifications listed</p>}
                            </div>
                            <div className="instructor-card-section availability-section">
                              <span className="instructor-section-label">{semester.toUpperCase()} AVAILABILITY</span>
                              {enabledInstructorBlocks.length ? (
                                <details className="instructor-availability-disclosure">
                                  <summary>Choose days and blocks <span>{availableBlocks.length} selected</span></summary>
                                  <div className="instructor-availability-grid">
                                    {[...days, 'Asynchronous'].map((day) => {
                                      const dayBlocks = enabledInstructorBlocks.filter((block) => block.category === 'Asynchronous' ? day === 'Asynchronous' : day !== 'Asynchronous')
                                      return dayBlocks.length ? (
                                        <fieldset className="instructor-availability-day" key={day}>
                                          <legend>{day}</legend>
                                          {dayBlocks.map((block) => {
                                            const selection = `${day} ${block.timeBlock}`
                                            return <label key={block.timeBlock}><input type="checkbox" checked={availableBlocks.includes(selection)} onChange={() => toggleInstructorAvailability(instructorId, selection)} /><span>{block.label} <small>{block.category === 'Normal' ? 'Daytime' : block.category}</small></span></label>
                                          })}
                                        </fieldset>
                                      ) : null
                                    })}
                                  </div>
                                </details>
                              ) : <p className="instructor-missing">Enable at least one approved block in University Blocks before setting availability.</p>}
                              <button className="save-instructor-availability" type="button" onClick={() => saveInstructorAvailability(item)} disabled={workspaceLoading || savingInstructorAvailabilityId === instructorId}>{savingInstructorAvailabilityId === instructorId ? 'Saving availability…' : `Save availability for ${semester}`}</button>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="instructor-empty"><span className="empty-state-icon" aria-hidden="true">⌕</span><h3>{workspace.instructors.length ? 'No instructors match your search.' : 'No instructor availability found.'}</h3><p>{workspace.instructors.length ? 'Try a different name, course code, or time block.' : 'Instructor resources will appear here when they are available.'}</p></div>
                  )}
                </section>
              )}
              {planningTab === "rooms" && (
                <section className="panel room-panel">
                  <div className="room-header">
                    <div>
                      <span className="eyebrow">SPACE RESOURCES</span>
                      <h2>Rooms and laboratories</h2>
                      <p>Review room capacity, type, equipment, and availability before assigning courses.</p>
                    </div>
                    <span className="room-total">{filteredRooms.length} <small>of {workspace.rooms.length} spaces</small></span>
                  </div>
                  <div className="room-toolbar">
                    <label className="room-search">
                      <span aria-hidden="true">⌕</span>
                      <input aria-label="Search rooms by number, building, type, or equipment" placeholder="Search room, building, type, or equipment" value={roomSearch} onChange={(event) => setRoomSearch(event.target.value)} />
                    </label>
                    <span>Capacity and facilities are shown for each space.</span>
                  </div>
                  {workspaceLoading ? (
                    <div className="room-empty" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true" /><h3>Loading rooms and laboratories…</h3></div>
                  ) : filteredRooms.length ? (
                    <div className="room-grid">
                      {filteredRooms.map((item) => {
                        const equipment = Array.isArray(item.equipment) ? item.equipment : (item.equipment ? [item.equipment] : [])
                        const availableBlocks = Array.isArray(item.availableBlocks) ? item.availableBlocks : (item.availableBlocks ? [item.availableBlocks] : [])
                        const isLab = `${item.roomType || ''}`.toLowerCase().includes('lab')
                        return (
                          <article className={`room-card${isLab ? ' lab-room' : ''}`} key={item.id || `${item.building}-${item.roomNumber}`}>
                            <div className="room-card-head">
                              <span className="room-icon" aria-hidden="true">{isLab ? '⚗' : '▦'}</span>
                              <div className="room-identity"><span>{item.building || 'Building not specified'}</span><h3>{item.roomNumber || 'Unnamed room'}</h3></div>
                              <span className="room-type-badge">{item.roomType || 'Room'}</span>
                            </div>
                            <div className="room-capacity"><strong>{item.capacity ?? '—'}</strong><span>seats</span><small>Maximum capacity</small></div>
                            <div className="room-card-section">
                              <span className="room-section-label">EQUIPMENT & FACILITIES</span>
                              {equipment.length ? <div className="room-tags">{equipment.map((feature, index) => <span className="room-tag" key={`${feature}-${index}`}>{feature}</span>)}</div> : <p className="room-missing">No equipment listed</p>}
                            </div>
                            {(availableBlocks.length > 0 || item.availableBlocks !== undefined) && (
                              <div className="room-card-section room-availability">
                                <span className="room-section-label">AVAILABLE BLOCKS <small>{availableBlocks.length}</small></span>
                                {availableBlocks.length ? <div className="room-tags">{availableBlocks.map((block, index) => <span className="room-time-tag" key={`${block}-${index}`}>{block}</span>)}</div> : <p className="room-missing">Availability not specified</p>}
                              </div>
                            )}
                          </article>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="room-empty"><span className="empty-state-icon" aria-hidden="true">⌕</span><h3>{workspace.rooms.length ? 'No rooms match your search.' : 'No rooms or laboratories found.'}</h3><p>{workspace.rooms.length ? 'Try a different room number, building, type, or equipment.' : 'Room resources will appear here when they are available.'}</p></div>
                  )}
                </section>
              )}
              {planningTab === "timeblocks" && (
                <section className="panel schedule-block-panel">
                  <div className="panel-title">
                    <div>
                      <span className="eyebrow">SEMESTER CONFIGURATION · {semester.toUpperCase()}</span>
                      <h2>University scheduling blocks</h2>
                      <p>Enable approved blocks and choose whether each can be used for lectures, laboratories, or both. Block times are fixed by the university.</p>
                    </div>
                    <button className="primary" type="button" onClick={saveScheduleBlocks} disabled={workspaceLoading || savingScheduleBlocks || !scheduleBlockDraft.length}>
                      {savingScheduleBlocks && <span className="inline-spinner" aria-hidden="true" />}
                      {savingScheduleBlocks ? 'Saving blocks…' : 'Save block settings'}
                    </button>
                  </div>
                  {workspaceLoading ? (
                    <div className="constraint-empty" role="status"><span className="loading-spinner" aria-hidden="true" /><h3>Loading semester blocks…</h3></div>
                  ) : (
                    <div className="schedule-block-list">
                      {scheduleBlockDraft.map((block) => (
                        <article className={`schedule-block-row${block.enabled ? '' : ' is-disabled'}`} key={block.timeBlock}>
                          <div className="schedule-block-main">
                            <label className="schedule-block-enable"><input type="checkbox" checked={Boolean(block.enabled)} onChange={(event) => updateScheduleBlock(block.timeBlock, (current) => ({ ...current, enabled: event.target.checked }))} /><span>{block.label}</span></label>
                            <span className={`schedule-block-category ${String(block.category).toLowerCase()}`}>{block.category === 'Normal' ? 'Daytime' : block.category}</span>
                          </div>
                          <fieldset disabled={!block.enabled}>
                            <legend>Available for</legend>
                            {['Lecture', 'Laboratory'].map((courseType) => (
                              <label key={courseType}><input type="checkbox" disabled={block.enabled && block.courseTypes?.length === 1 && block.courseTypes.includes(courseType)} checked={block.courseTypes?.includes(courseType) || false} onChange={(event) => updateScheduleBlock(block.timeBlock, (current) => ({ ...current, courseTypes: event.target.checked ? [...new Set([...(current.courseTypes || []), courseType])] : (current.courseTypes || []).filter((item) => item !== courseType) }))} />{courseType}</label>
                            ))}
                          </fieldset>
                        </article>
                      ))}
                    </div>
                  )}
                  <p className="schedule-block-note">These settings apply to {semester}. Choose blocks that match instructor and room availability for this semester.</p>
                </section>
              )}
              {planningTab === "constraints" && (
                <section className="panel constraint-panel">
                  <div className="constraint-header">
                    <div>
                      <span className="eyebrow">SCHEDULER RULES</span>
                      <h2>Scheduling constraints</h2>
                      <p>Review the rules that guide schedule generation and validation.</p>
                    </div>
                    <span className="constraint-total">{filteredConstraints.length} <small>of {workspace.constraints.length} rules</small></span>
                  </div>
                  <div className="constraint-toolbar">
                    <label className="constraint-search">
                      <span aria-hidden="true">⌕</span>
                      <input aria-label="Search constraints by name, type, priority, or description" placeholder="Search rules or descriptions" value={constraintSearch} onChange={(event) => setConstraintSearch(event.target.value)} />
                    </label>
                    <span>Choose which rules are enabled for planning.</span>
                  </div>
                  {workspaceLoading ? (
                    <div className="constraint-empty" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true" /><h3>Loading scheduling constraints…</h3></div>
                  ) : filteredConstraints.length ? (
                    <div className="constraint-list">
                      {filteredConstraints.map((item) => {
                        const enabled = item.enabled === true || item.enabled === 'true' || item.enabled === 1
                        const priorityLabel = item.priority || 'Standard'
                        return (
                          <article className={`constraint-card${enabled ? '' : ' constraint-disabled'}`} key={item.id || item.name}>
                            <div className="constraint-status-icon" aria-hidden="true">{enabled ? '✓' : '–'}</div>
                            <div className="constraint-body">
                              <div className="constraint-title-row">
                                <div><h3>{item.name || 'Unnamed rule'} <span className="constraint-tooltip" tabIndex="0" role="img" aria-label={`Help: ${item.name || 'scheduling rule'}. ${item.description || 'No description provided.'}`} title={item.description || 'No description provided.'} data-tooltip={item.description || 'No description provided.'}>?</span></h3><span className="constraint-type">{item.type || 'General rule'}</span></div>
                                <button
                                  className={`constraint-toggle${enabled ? ' is-on' : ''}`}
                                  type="button"
                                  role="switch"
                                  aria-checked={enabled}
                                  aria-label={`${enabled ? 'Disable' : 'Enable'} ${item.name || 'scheduling rule'}`}
                                  onClick={() => toggleConstraint(item)}
                                  disabled={workspaceLoading}
                                >
                                  <span aria-hidden="true" />
                                  {enabled ? 'Enabled' : 'Disabled'}
                                </button>
                              </div>
                              <p>{item.description || 'No description provided for this scheduling rule.'}</p>
                              <div className="constraint-footer"><span className={`priority-badge priority-${String(priorityLabel).toLowerCase()}`}><b aria-hidden="true">◆</b> {priorityLabel} priority</span><span>{enabled ? 'Enabled for planning' : 'Disabled for planning'}</span></div>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="constraint-empty"><span className="empty-state-icon" aria-hidden="true">⌕</span><h3>{workspace.constraints.length ? 'No rules match your search.' : 'No scheduling constraints found.'}</h3><p>{workspace.constraints.length ? 'Try a different rule name, type, or keyword.' : 'Scheduling rules will appear here when they are available.'}</p></div>
                  )}
                </section>
              )}
              {planningTab === "import" && (
                <section className="panel schedule-import-panel">
                  <div className="panel-title">
                    <div>
                      <span className="eyebrow">DATA INTAKE · {semester.toUpperCase()}</span>
                      <h2>Import scheduling data</h2>
                      <p>Upload a workbook or matching CSV files. Review the mapped rows and validation issues before saving anything.</p>
                    </div>
                  </div>
                  <div className="import-upload-row">
                    <label className="import-file-picker">CSV files or Excel workbook (.xlsx)
                      <input type="file" accept=".csv,.xlsx" multiple onChange={(event) => { setImportFiles(Array.from(event.target.files || [])); setImportPreview(null); setImportSummary(null) }} />
                    </label>
                    <span>{importFiles.length ? importFiles.map((file) => file.name).join(', ') : 'No files selected'}</span>
                    <button className="primary" type="button" onClick={previewScheduleImport} disabled={importLoading || !importFiles.length} aria-busy={importLoading}>
                      {importLoading && <span className="inline-spinner" aria-hidden="true" />}
                      {importLoading ? 'Reading and validating…' : 'Preview import'}
                    </button>
                  </div>
                  <details className="import-format-guide">
                    <summary>Sample format and column guide</summary>
                    <p>Download CSV examples below, or use one Excel workbook with sheets named <b>Courses</b>, <b>Instructors</b>, <b>Rooms</b>, <b>InstructorAvailability</b>, and <b>RoomAvailability</b>. Each sheet uses the same headers as its CSV template. The selected semester ({semester}) is applied to imported courses and availability.</p>
                    <div className="import-template-buttons">
                      {['Courses', 'Instructors', 'Rooms', 'InstructorAvailability', 'RoomAvailability'].map((kind) => <button type="button" key={kind} onClick={() => downloadImportCsvTemplate(kind)}>Download {kind.replace(/([a-z])([A-Z])/g, '$1 $2')} CSV</button>)}
                    </div>
                    <div className="import-format-notes">
                      <p><b>Courses:</b> CourseCode, CourseTitle, Credits, HistoricalEnrollment, PredictedEnrollment, RequiresLab, RequiredEquipment, CrossListedWith, CoLocationGroup, InstructorName, RoomNumber</p>
                      <p><b>Instructors:</b> Name, QualifiedCourses, PreferredCourses, MaximumCourseLoad, PrefersBackToBack</p>
                      <p><b>Rooms:</b> RoomNumber, Building, Capacity, RoomType, Equipment</p>
                      <p><b>Availability sheets:</b> InstructorName or RoomNumber, Day, TimeBlock. Use an approved time block value such as <code>09:20-10:10</code>. Asynchronous instructor availability uses <code>Asynchronous</code> and <code>ASYNC</code>.</p>
                      <small>Separate qualified courses, preferred courses, or equipment items with semicolons. RequiresLab and PrefersBackToBack accept true/false, yes/no, or 1/0. Unrecognized optional InstructorName or RoomNumber references appear as warnings.</small>
                    </div>
                  </details>
                  {importPreview && (
                    <div className="import-review" aria-live="polite">
                      <div className="import-review-heading"><div><h3>Import preview</h3><p>{importPreview.canConfirm ? 'Valid records are ready to import. Rows with errors are excluded.' : 'Fix the required headers or file issues before confirming this import.'}</p></div><span>{importPreview.errors?.length || 0} error(s) · {importPreview.warnings?.length || 0} warning(s)</span></div>
                      <div className="import-count-grid">
                        <div><strong>{importPreview.batch?.courses?.length || 0}</strong><span>Courses</span></div>
                        <div><strong>{importPreview.batch?.instructors?.length || 0}</strong><span>Instructors</span></div>
                        <div><strong>{importPreview.batch?.rooms?.length || 0}</strong><span>Rooms</span></div>
                        <div><strong>{importPreview.batch?.instructorAvailability?.length || 0}</strong><span>Instructor availability records</span></div>
                      </div>
                      {(importPreview.errors?.length > 0 || importPreview.warnings?.length > 0) && (
                        <div className="import-issues">
                          {[...(importPreview.errors || []), ...(importPreview.warnings || [])].slice(0, 30).map((issue, index) => <p className={issue.severity === 'Error' ? 'is-error' : 'is-warning'} key={`${issue.source}-${issue.row}-${index}`}><b>{issue.severity}</b> · {issue.source}{issue.row ? `, row ${issue.row}` : ''}: {issue.message}</p>)}
                          {(importPreview.errors.length + importPreview.warnings.length > 30) && <small>Showing the first 30 issues.</small>}
                        </div>
                      )}
                      <div className="import-preview-tables">
                        {[
                          ['Courses', importPreview.batch?.courses || [], (row) => `${row.courseCode} — ${row.courseTitle} · ${row.predictedEnrollment} enrollment`],
                          ['Instructors', importPreview.batch?.instructors || [], (row) => `${row.name} · ${row.qualifiedCourses?.length || 0} qualified course(s)`],
                          ['Rooms', importPreview.batch?.rooms || [], (row) => `${row.roomNumber} · ${row.capacity} seats · ${row.roomType}`],
                        ].map(([title, rows, describe]) => (
                          <section key={title}><h4>{title} preview <small>({rows.length})</small></h4>{rows.length ? rows.slice(0, 5).map((row, index) => <p key={row.id || `${title}-${index}`}>{describe(row)}</p>) : <p>No valid {title.toLowerCase()} rows.</p>}{rows.length > 5 && <small>And {rows.length - 5} more…</small>}</section>
                        ))}
                      </div>
                      <div className="import-confirm-row"><p>Confirming saves valid records to the workspace. Invalid rows stay out of MongoDB.</p><button className="primary" type="button" onClick={confirmScheduleImport} disabled={!importPreview.canConfirm || importConfirming}>{importConfirming ? 'Importing…' : 'Confirm and import valid records'}</button></div>
                    </div>
                  )}
                  {importSummary && (
                    <div className="import-summary" role="status">
                      <h3>Import complete</h3>
                      <div className="import-count-grid">
                        <div><strong>{importSummary.coursesImported}</strong><span>Courses imported</span></div>
                        <div><strong>{importSummary.instructorsImported}</strong><span>Instructors imported</span></div>
                        <div><strong>{importSummary.roomsImported}</strong><span>Rooms imported</span></div>
                        <div><strong>{importSummary.availabilityRecordsSaved}</strong><span>Availability records saved</span></div>
                      </div>
                      {(importSummary.errors?.length > 0 || importSummary.warnings?.length > 0) && <div className="import-issues">{[...(importSummary.errors || []), ...(importSummary.warnings || [])].map((issue, index) => <p className={issue.severity === 'Error' ? 'is-error' : 'is-warning'} key={`${issue.source}-${index}`}><b>{issue.severity}</b> · {issue.source}: {issue.message}</p>)}</div>}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
          {view === "schedule" && (
            <section className="panel schedule-panel">
              <div className="panel-title">
                <div>
                  <span className="eyebrow">SCHEDULE BUILDER · {semester.toUpperCase()}</span>
                  <label className="draft-name-field">Draft name
                    <input
                      value={draft?.name || ''}
                      onChange={(event) => {
                        setDraft((current) => current ? { ...current, name: event.target.value } : current)
                        setSavedDraftId(null)
                      }}
                      aria-label="Draft name"
                      maxLength={120}
                    />
                  </label>
                  <p className={`draft-save-state${savedDraftId ? ' is-saved' : ''}`} role="status">
                    {savedDraftId ? 'All changes saved.' : 'Unsaved changes — save this draft to keep your latest version.'}
                  </p>
                  <p>Review the weekly layout. Select any course card to edit its assignment.</p>
                </div>
                <div className="schedule-actions">
                  <button onClick={validateDraft} disabled={!draft || loading || validationLoading} aria-busy={validationLoading}>{validationLoading && <span className="inline-spinner" aria-hidden="true" />}{validationLoading ? 'Validating…' : 'Validate'}</button>
                  <button onClick={saveDraft} disabled={!draft || loading}>Save draft</button>
                  <details className="schedule-export-menu">
                    <summary aria-label="Export or print schedule">Export <svg className="export-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></summary>
                    <div className="schedule-export-options">
                      <button type="button" onClick={(event) => { event.currentTarget.closest('details').open = false; exportCsv() }} disabled={!draft || loading}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 2.75h8l4 4v10.5H4zM12 2.75v4h4M7 10h6M7 13h6" /></svg>Download CSV</button>
                      <button type="button" onClick={() => openPrintView(true)} disabled={!draft || loading}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.75h7l3 3v11.5H5zM12 2.75v3h3M7.5 10h5M7.5 13h5" /><path d="M8 16v1.5h4V16" /></svg>Save as PDF</button>
                      <button type="button" onClick={() => openPrintView()} disabled={!draft || loading}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7V3h10v4M5 14H3.5V8.5h13V14H15M5 12h10v5H5zM14 10.5h.01" /></svg>Open print view</button>
                    </div>
                  </details>
                  <button className="primary" onClick={() => generateDraft()} disabled={loading} aria-busy={loading}>{loading && <span className="inline-spinner" aria-hidden="true" />}{loading ? 'Generating…' : '✦ Regenerate'}</button>
                </div>
              </div>
              {draft ? (
                <>
                <div className="schedule-summary">
                  <span><strong>{scheduledCount}</strong> assignments</span>
                  <span><strong>{assignedCount}</strong> fully assigned</span>
                  <span className={`validation-pill ${validationStatus}`} role="status" aria-live="polite">{validationLoading ? <><span className="inline-spinner" aria-hidden="true" />Validating…</> : validationStatus === 'valid' ? '✓ Validated' : validationStatus === 'issues' ? '⚠ Needs review' : '○ Not validated'}</span>
                  <small>Select a card to edit instructor, room, day, or time.</small>
                </div>
                <section className="schedule-utilization" aria-labelledby="schedule-utilization-title">
                  <div className="utilization-header">
                    <div><span className="eyebrow">SCHEDULE OVERVIEW</span><h2 id="schedule-utilization-title">Schedule utilization</h2><p>{hasScheduleFilters ? 'Summary for the courses matching the current filters.' : 'Review how courses, rooms, and instructors are distributed.'}</p></div>
                    <span className="utilization-course-count">{filteredScheduleSections.length} course(s)</span>
                  </div>
                  <div className="utilization-metrics">
                    <article className="utilization-metric"><span>Room utilization</span><strong>{scheduleUtilization.roomUtilization == null ? '—' : `${scheduleUtilization.roomUtilization}%`}</strong><small>{scheduleUtilization.occupiedRoomSlots} of {scheduleUtilization.availableRoomSlots} available room blocks used</small></article>
                    <article className="utilization-metric"><span>Laboratory courses</span><strong>{scheduleUtilization.laboratoryCourses}</strong><small>In the displayed schedule</small></article>
                    <article className={`utilization-metric${scheduleUtilization.unassignedRooms ? ' has-warning' : ''}`}><span>Unassigned rooms</span><strong>{scheduleUtilization.unassignedRooms}</strong><small>Courses without a room</small></article>
                    <article className={`utilization-metric${scheduleUtilization.unassignedInstructors ? ' has-warning' : ''}`}><span>Unassigned instructors</span><strong>{scheduleUtilization.unassignedInstructors}</strong><small>Courses without an instructor</small></article>
                  </div>
                  <div className="utilization-details">
                    <section className="utilization-chart" aria-labelledby="courses-by-day-title">
                      <h3 id="courses-by-day-title">Courses per day</h3>
                      <div className="day-utilization-list">
                        {scheduleUtilization.coursesPerDay.map(({ day, count }) => {
                          const maxCount = Math.max(1, ...scheduleUtilization.coursesPerDay.map((item) => item.count))
                          return <div className="day-utilization-row" key={day}><span>{day}</span><div className="utilization-track"><i style={{ width: `${count / maxCount * 100}%` }} /></div><strong>{count}</strong></div>
                        })}
                      </div>
                    </section>
                    <section className="utilization-chart" aria-labelledby="peak-period-title">
                      <h3 id="peak-period-title">Peak scheduling periods</h3>
                      {scheduleUtilization.peakPeriod ? (
                        <>
                          <p className="peak-period-summary"><strong>{formatScheduleTimeBlock(scheduleUtilization.peakPeriod.timeBlock, workspace.scheduleBlocks)}</strong><span>{scheduleUtilization.peakPeriod.count} course(s), busiest time block</span></p>
                          <div className="peak-period-list">{scheduleUtilization.periods.slice(0, 4).map((period) => <div className="peak-period-row" key={period.timeBlock}><span>{formatScheduleTimeBlock(period.timeBlock, workspace.scheduleBlocks)}</span><strong>{period.count}</strong></div>)}</div>
                        </>
                      ) : <p className="utilization-empty">No time blocks are assigned yet.</p>}
                    </section>
                    <section className="utilization-chart instructor-distribution" aria-labelledby="workload-distribution-title">
                      <h3 id="workload-distribution-title">Instructor workload distribution</h3>
                      {scheduleUtilization.instructorDistribution.length ? (
                        <div className="instructor-distribution-list">
                          {scheduleUtilization.instructorDistribution.map((item) => {
                            const overloaded = item.maximumLoad != null && item.assignments > item.maximumLoad
                            const denominator = Math.max(item.maximumLoad || 0, 1)
                            return <div className={`instructor-distribution-row${overloaded ? ' is-overloaded' : ''}`} key={item.id}><span>{item.name || 'Unnamed instructor'}</span><div className="utilization-track"><i style={{ width: `${Math.min(100, item.assignments / denominator * 100)}%` }} /></div><strong>{item.assignments}{item.maximumLoad == null ? '' : ` / ${item.maximumLoad}`}</strong></div>
                          })}
                        </div>
                      ) : <p className="utilization-empty">No instructor records are available.</p>}
                    </section>
                  </div>
                </section>
                <section className="schedule-filter-panel" aria-label="Filter schedule assignments">
                  <div className="schedule-filter-heading">
                    <div><strong>Filter schedule</strong><span>Showing {filteredScheduleSections.length} of {scheduledCount} courses</span></div>
                    <button type="button" onClick={() => setScheduleFilters({ courseCode: '', instructorId: '', roomId: '', day: '', timeBlock: '', type: '', status: '' })} disabled={!hasScheduleFilters}>Clear filters</button>
                  </div>
                  <div className="schedule-filter-grid">
                    <label>Course code<input type="search" placeholder="Search course code" value={scheduleFilters.courseCode} onChange={(event) => setScheduleFilters((current) => ({ ...current, courseCode: event.target.value }))} /></label>
                    <label>Instructor<select value={scheduleFilters.instructorId} onChange={(event) => setScheduleFilters((current) => ({ ...current, instructorId: event.target.value }))}><option value="">All instructors</option><option value="__unassigned__">Unassigned</option>{scheduleInstructorOptions.map((item) => <option key={item.id} value={item.id}>{item.name || 'Unnamed instructor'}</option>)}</select></label>
                    <label>Room<select value={scheduleFilters.roomId} onChange={(event) => setScheduleFilters((current) => ({ ...current, roomId: event.target.value }))}><option value="">All rooms</option><option value="__unassigned__">Unassigned</option>{scheduleRoomOptions.map((item) => <option key={item.id} value={item.id}>{item.name || 'Unnamed room'}</option>)}</select></label>
                    <label>Day<select value={scheduleFilters.day} onChange={(event) => setScheduleFilters((current) => ({ ...current, day: event.target.value }))}><option value="">All days</option>{scheduleDays.map((day) => <option key={day} value={day}>{day}</option>)}</select></label>
                    <label>Time block<select value={scheduleFilters.timeBlock} onChange={(event) => setScheduleFilters((current) => ({ ...current, timeBlock: event.target.value }))}><option value="">All time blocks</option><option value="__unassigned__">Unassigned</option>{scheduleTimeOptions.map((time) => <option key={time} value={time}>{formatScheduleTimeBlock(time, workspace.scheduleBlocks)}</option>)}</select></label>
                    <label>Course type<select value={scheduleFilters.type} onChange={(event) => setScheduleFilters((current) => ({ ...current, type: event.target.value }))}><option value="">Lecture and laboratory</option><option value="lecture">Lecture</option><option value="lab">Laboratory</option></select></label>
                    <label>Validation status<select value={scheduleFilters.status} onChange={(event) => setScheduleFilters((current) => ({ ...current, status: event.target.value }))} disabled={validationStatus === 'pending' || validationLoading}><option value="">All statuses</option><option value="valid">Valid</option><option value="conflict">Conflict</option></select></label>
                  </div>
                </section>
                <div className="calendar">
                  {scheduleDays.map((day) => (
                    <div className="day" key={day}>
                      <h3><span>{day}</span><span className="day-count">{filteredScheduleSections.filter((section) => section.day === day).length}</span></h3>
                      {filteredScheduleSections.filter((section) => section.day === day)
                        .map((s, i) => (
                          <button className={`course ${s.isLab ? 'lab' : ''}`} key={`${s.courseCode}-${i}`} onClick={() => startEdit(s)} aria-label={`Edit ${s.courseCode} ${s.isLab ? 'laboratory' : 'lecture'} assignment`}>
                            <span className="course-topline"><b>{s.courseCode}</b><span className="course-kind">{s.isLab ? "Lab" : "Lecture"}</span></span>
                            <strong className="course-time">{formatScheduleTimeBlock(s.timeBlock, workspace.scheduleBlocks)}</strong>
                            <span className="course-meta">⌖ {s.timeBlock === 'ASYNC' ? 'Online / asynchronous' : s.roomNumber || "Room unassigned"}</span>
                            <span className="course-meta">◉ {s.instructorName || "Instructor unassigned"}</span>
                            <span className="course-hint">Click to edit <span aria-hidden="true">↗</span></span>
                          </button>
                        ))}
                      {!filteredScheduleSections.some((section) => section.day === day) && <p className="day-empty">{hasScheduleFilters ? 'No matching courses' : 'No assignments'}</p>}
                    </div>
                  ))}
                </div>
                <section className="workload-panel" aria-labelledby="instructor-workload-title">
                  <div className="workload-header">
                    <div>
                      <span className="eyebrow">INSTRUCTOR LOAD</span>
                      <h2 id="instructor-workload-title">Instructor workload</h2>
                      <p>Compare assigned courses with each instructor’s maximum load.</p>
                    </div>
                    <span className="workload-count">{instructorWorkload.filter((item) => item.overloaded).length} overloaded</span>
                  </div>
                  <div className="workload-table-scroll">
                    <table className="workload-table">
                      <thead>
                        <tr><th scope="col">Instructor</th><th scope="col">Assigned courses</th><th scope="col">Maximum load</th><th scope="col">Status</th><th scope="col">Actions</th></tr>
                      </thead>
                      <tbody>
                        {instructorWorkload.length ? instructorWorkload.map(({ instructor, assignments, overloaded }) => (
                          <tr key={instructor.id || instructor.name}>
                            <td><strong>{instructor.name || 'Unnamed instructor'}</strong></td>
                            <td><span className="workload-assignment-count">{assignments.length}</span></td>
                            <td>{instructor.maximumCourseLoad ?? '—'}</td>
                            <td><span className={`workload-status${overloaded ? ' is-overloaded' : ''}`}><i aria-hidden="true" />{overloaded ? 'Overloaded' : 'Available'}</span></td>
                            <td>
                              {assignments.length ? (
                                <div className="workload-edit-actions">
                                  {assignments.map((section) => <button type="button" key={section.courseCode} onClick={() => startEdit(section)} aria-label={`Edit ${section.courseCode} assignment for ${instructor.name}`}>Edit {section.courseCode}</button>)}
                                </div>
                              ) : <span className="workload-no-actions">No assignments</span>}
                            </td>
                          </tr>
                        )) : (
                          <tr><td colSpan="5" className="empty">No instructor records available.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
                </>
              ) : (
                <div className="empty-state">
                  <span className="empty-state-icon" aria-hidden="true">▤</span>
                  <h2>No schedule draft exists yet.</h2>
                  <p>Select your courses in Planning Workspace, then generate a draft to begin.</p>
                  <button className="primary" onClick={() => { navigateToView('planning'); setPlanningTab('offerings') }}>Select courses</button>
                </div>
              )}
            </section>
          )}
          {view === 'print' && draft && (
            <section className="print-view" aria-labelledby="print-schedule-title">
              <div className="print-view-actions">
                <button type="button" onClick={() => navigateToView('schedule')}>← Back to schedule</button>
                <button type="button" className="primary" onClick={() => window.print()}>Print / Save as PDF</button>
                <span>Choose “Save as PDF” in the print dialog to download a PDF.</span>
              </div>
              <header className="print-document-header">
                <span className="eyebrow">SCHEDULESPARK · {draft.semester || semester}</span>
                <h1 id="print-schedule-title">{draft.name || 'Schedule draft'}</h1>
                <div className="print-metadata">
                  <span><b>Semester</b>{draft.semester || semester}</span>
                  <span><b>Draft name</b>{draft.name || 'Schedule draft'}</span>
                  <span><b>Schedule status</b><strong className={`print-status ${scheduleStatusLabel === 'Valid' ? 'is-valid' : 'is-review'}`}>{scheduleStatusLabel}</strong></span>
                </div>
              </header>
              <section className="print-conflict-summary">
                <div><h2>Conflict summary</h2><span>{conflicts.length} {conflicts.length === 1 ? 'conflict' : 'conflicts'}</span></div>
                {conflicts.length ? (
                  <ul>{conflicts.map((item, index) => {
                    const conflict = typeof item === 'string' ? { message: item } : item
                    return <li key={`${getConflictComparisonKey(item)}-${index}`}><b>{conflict.category || conflict.code || 'Scheduling conflict'}</b> — {conflict.message || 'Review this assignment.'}</li>
                  })}</ul>
                ) : <p>{scheduleStatusLabel === 'Valid' ? 'No conflicts found.' : 'No conflict details are available. Validate the schedule for an updated summary.'}</p>}
              </section>
              <section className="print-course-section">
                <h2>Course schedule</h2>
                <table>
                  <thead><tr><th scope="col">Course</th><th scope="col">Instructor</th><th scope="col">Room</th><th scope="col">Day</th><th scope="col">Time</th></tr></thead>
                  <tbody>{(draft.sections || []).map((section, index) => <tr key={`${section.courseCode}-${index}`}><td>{section.courseCode || '—'}</td><td>{section.instructorName || 'Unassigned'}</td><td>{section.roomNumber || 'Unassigned'}</td><td>{section.day || 'Unassigned'}</td><td>{section.timeBlock || 'Unassigned'}</td></tr>)}</tbody>
                </table>
              </section>
            </section>
          )}
          {view === "conflicts" && (
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h2>Conflict review</h2>
                  <p>Required constraint violations from the selected draft.</p>
                </div>
                <button onClick={validateDraft} disabled={!draft || validationLoading} aria-busy={validationLoading}>
                  {validationLoading && <span className="inline-spinner" aria-hidden="true" />}
                  {validationLoading ? 'Validating…' : 'Run validation'}
                </button>
              </div>
              {conflicts.length ? (
                conflicts.map((item, i) => {
                  const conflict = typeof item === 'string' ? { message: item } : item
                  const rawAffectedCodes = conflict.affectedCourseCodes?.length
                    ? conflict.affectedCourseCodes
                    : (conflict.courseCodes?.length ? conflict.courseCodes : [conflict.courseCode, conflict.conflictingCourseCode, conflict.relatedCourseCode].filter(Boolean))
                  const affectedCodes = (Array.isArray(rawAffectedCodes) ? rawAffectedCodes : [rawAffectedCodes])
                    .flatMap((value) => typeof value === 'string' ? value.split(',') : [value])
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
                  const affectedCodeSet = new Set(affectedCodes.map((code) => code.toLowerCase()))
                  const affectedSections = (draft?.sections || []).filter((section) => affectedCodeSet.has((section.courseCode || '').toLowerCase()))
                  const quickFixesByCourse = new Map(affectedSections.map((section) => [section.courseCode, getConflictQuickFixes(conflict, section)]))
                  return (
                    <article className="conflict detailed-conflict conflict-card" key={i} role="alert">
                      <b className="conflict-icon" aria-hidden="true">!</b>
                      <div className="conflict-content">
                        <div className="conflict-heading">
                          <div>
                            <span className="conflict-kicker">SCHEDULING CONFLICT</span>
                            <strong>{conflict.category || conflict.type || "Scheduling conflict"}</strong>
                          </div>
                          <span className={`conflict-severity ${String(conflict.severity || 'Required').toLowerCase()}`}>{conflict.severity || 'Required'}</span>
                        </div>
                        <div className="conflict-course-list">
                          <span className="conflict-section-label">AFFECTED COURSE{affectedCodes.length === 1 ? '' : 'S'}</span>
                          <div>{affectedCodes.length ? affectedCodes.map((code) => <span className="affected-course-chip" key={code}>{code}</span>) : <span className="affected-course-chip">Multiple courses</span>}</div>
                        </div>
                        <p className="conflict-message">{conflict.message || 'This assignment conflicts with another schedule requirement.'}</p>
                        <details className="conflict-help">
                          <summary>What does this conflict mean?</summary>
                          <p>{getConflictExplanation(conflict)}</p>
                        </details>
                        {affectedSections.length > 0 ? (
                          <div className="conflict-assignments">
                            {affectedSections.map((section, sectionIndex) => (
                              <div className="conflict-assignment" key={`${section.courseCode}-${sectionIndex}`}>
                                <div className="assignment-details">
                                  <strong>{section.courseCode} <small>Current assignment</small></strong>
                                  <span><b>Day / time</b>{section.day || 'Unassigned'} · {formatScheduleTimeBlock(section.timeBlock, workspace.scheduleBlocks)}</span>
                                  <span><b>Room</b>{section.roomNumber || 'Unassigned'}</span>
                                  <span><b>Instructor</b>{section.instructorName || 'Unassigned'}</span>
                                </div>
                                <button className="conflict-edit-button" onClick={() => startEdit(section)} aria-label={`Edit assignment for ${section.courseCode}`}>Edit assignment <span aria-hidden="true">↗</span></button>
                                {quickFixesByCourse.get(section.courseCode)?.length > 0 && (
                                  <div className="conflict-quick-fixes" aria-label={`Quick fixes for ${section.courseCode}`}>
                                    <span>Recommended quick fixes</span>
                                    {quickFixesByCourse.get(section.courseCode).map((fix) => (
                                      <button key={fix.label} type="button" onClick={() => startEdit(section, fix.assignment)}>{fix.label}</button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="conflict-assignment-unavailable">Current assignment details are unavailable. Open the schedule to choose a course card to edit.</p>
                        )}
                        <div className="conflict-suggestion"><span aria-hidden="true">↳</span><div><b>Suggested action</b><p>{conflict.suggestedAction || 'Review the affected course assignments and choose a different room, time, or instructor.'}</p></div></div>
                      </div>
                    </article>
                  )
                })
              ) : validationStatus === 'valid' ? (
                <div className="empty-state success-state" role="status">
                  <span className="empty-state-icon" aria-hidden="true">✓</span>
                  <h2>No conflicts found. Your schedule is ready for review.</h2>
                  <p>All required scheduling rules passed validation.</p>
                </div>
              ) : (
                <div className="empty-state">
                  <span className="empty-state-icon" aria-hidden="true">i</span>
                  <h2>{draft ? 'No conflicts to display yet.' : 'No schedule to review yet.'}</h2>
                  <p>{draft ? 'Run validation to check this schedule for conflicts.' : 'Generate a draft to check its assignments.'}</p>
                </div>
              )}
            </section>
          )}
          {view === "saved" && (
            <section className="panel saved-panel">
              <div className="saved-header">
                <div>
                  <span className="eyebrow">SCHEDULE HISTORY</span>
                  <h2 id="saved-drafts-title" tabIndex={-1}>Saved schedule drafts</h2>
                  <p>Reopen a saved version to review assignments and continue planning.</p>
                </div>
                <div className="saved-header-actions">
                  <span className="saved-count">{filteredSavedDrafts.length} <small>of {savedDrafts.length} drafts</small></span>
                  <button onClick={() => loadDrafts(true)} disabled={draftsLoading}>{draftsLoading ? 'Refreshing…' : '↻ Refresh'}</button>
                </div>
              </div>
              {draftsLoading ? (
                <div className="empty-state" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true" /> <h2>Loading saved drafts…</h2></div>
              ) : savedDrafts.length ? (
                <>
                  <label className="saved-search"><span aria-hidden="true">⌕</span><input aria-label="Search saved drafts" placeholder="Search by draft name, semester, or status" value={savedDraftSearch} onChange={(event) => setSavedDraftSearch(event.target.value)} /></label>
                  <section className="draft-comparison-panel" aria-labelledby="draft-comparison-title">
                    <div className="draft-comparison-heading">
                      <div>
                        <span className="eyebrow">VERSION REVIEW</span>
                        <h2 id="draft-comparison-title">Compare drafts</h2>
                        <p>Review assignment changes and conflicts using the current enabled rules.</p>
                      </div>
                    </div>
                    <div className="draft-comparison-controls">
                      <label>Draft A
                        <select value={compareDraftAId} onChange={(event) => { setCompareDraftAId(event.target.value); setDraftComparison(null) }}>
                          <option value="">Select a saved draft</option>
                          {savedDrafts.map((item) => <option key={item.id || item._id} value={item.id || item._id}>{item.name || 'Untitled draft'} · {item.semester || 'Semester not specified'}</option>)}
                        </select>
                      </label>
                      <span className="comparison-versus" aria-hidden="true">vs</span>
                      <label>Draft B
                        <select value={compareDraftBId} onChange={(event) => { setCompareDraftBId(event.target.value); setDraftComparison(null) }}>
                          <option value="">Select a saved draft</option>
                          {savedDrafts.map((item) => <option key={item.id || item._id} value={item.id || item._id}>{item.name || 'Untitled draft'} · {item.semester || 'Semester not specified'}</option>)}
                        </select>
                      </label>
                      <button className="primary" type="button" onClick={compareDrafts} disabled={comparisonLoading || !compareDraftAId || !compareDraftBId || compareDraftAId === compareDraftBId}>
                        {comparisonLoading ? 'Comparing…' : 'Compare drafts'}
                      </button>
                    </div>
                    {comparisonLoading ? (
                      <div className="comparison-loading" role="status"><span className="loading-spinner" aria-hidden="true" /> Comparing assignments and validating conflicts…</div>
                    ) : draftComparison && (
                      <div className="draft-comparison-results" aria-live="polite">
                        <div className="comparison-result-heading">
                          <strong>{draftComparison.draftA.name} <span>→</span> {draftComparison.draftB.name}</strong>
                          <span>{draftComparison.assignmentChanges.length} assignment change(s)</span>
                        </div>
                        {draftComparison.assignmentChanges.length ? (
                          <div className="comparison-changes">
                            {draftComparison.assignmentChanges.map((change, index) => (
                              <article className="comparison-change" key={`${change.courseCode}-${change.type}-${index}`}>
                                <div><span className="comparison-course">{change.courseCode}</span><strong>{change.type}</strong></div>
                                <p><span>{change.from}</span><b aria-hidden="true">→</b><span>{change.to}</span></p>
                              </article>
                            ))}
                          </div>
                        ) : <p className="comparison-no-changes">No course assignments changed between these drafts.</p>}
                        <div className="comparison-conflict-columns">
                          <section className="comparison-conflict-group added-conflicts">
                            <h3>New conflicts <span>{draftComparison.addedConflicts.length}</span></h3>
                            {draftComparison.addedConflicts.length ? draftComparison.addedConflicts.map((item, index) => {
                              const conflict = typeof item === 'string' ? { message: item } : item
                              return <article key={`${getConflictComparisonKey(item)}-${index}`}><strong>{conflict.category || conflict.code || 'Scheduling conflict'}</strong><p>{conflict.message || 'A conflict appears in Draft B.'}</p></article>
                            }) : <p className="comparison-conflict-empty">No new conflicts.</p>}
                          </section>
                          <section className="comparison-conflict-group resolved-conflicts">
                            <h3>Conflicts resolved <span>{draftComparison.resolvedConflicts.length}</span></h3>
                            {draftComparison.resolvedConflicts.length ? draftComparison.resolvedConflicts.map((item, index) => {
                              const conflict = typeof item === 'string' ? { message: item } : item
                              return <article key={`${getConflictComparisonKey(item)}-${index}`}><strong>{conflict.category || conflict.code || 'Scheduling conflict'}</strong><p>{conflict.message || 'A conflict from Draft A is resolved in Draft B.'}</p></article>
                            }) : <p className="comparison-conflict-empty">No conflicts resolved.</p>}
                          </section>
                        </div>
                      </div>
                    )}
                  </section>
                  {filteredSavedDrafts.length ? (
                    <div className="saved-draft-grid">
                      {filteredSavedDrafts.map((item) => {
                        const violationCount = Number(item.requiredViolationCount || 0)
                        const normalizedStatus = String(item.status || 'Draft').toLowerCase()
                        const statusLabel = item.status || 'Draft'
                        const statusClass = normalizedStatus.includes('invalid') || normalizedStatus.includes('conflict') || normalizedStatus.includes('issue') ? 'saved-status-issues' : normalizedStatus === 'valid' || normalizedStatus.includes('validated') || normalizedStatus === 'ready' ? 'saved-status-valid' : 'saved-status-neutral'
                        const modifiedDate = item.lastModifiedAtUtc || item.createdAtUtc
                        const parsedModifiedDate = modifiedDate ? new Date(modifiedDate) : null
                        const formattedModifiedDate = parsedModifiedDate && !Number.isNaN(parsedModifiedDate.getTime()) ? parsedModifiedDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable'
                        return (
                          <article className="saved-draft-card" key={item.id || item._id}>
                            <div className="saved-draft-topline">
                              <span className="saved-draft-icon" aria-hidden="true">▤</span>
                              <span className={`saved-status ${statusClass}`}><i aria-hidden="true" />{statusLabel}</span>
                            </div>
                            <h3>{item.name || 'Untitled schedule draft'}</h3>
                            <span className="saved-semester">{item.semester || 'Semester not specified'}</span>
                            <div className="saved-draft-metrics">
                              <div className={violationCount ? 'has-violations' : 'no-violations'}><strong>{violationCount}</strong><span>{violationCount === 1 ? 'required violation' : 'required violations'}</span></div>
                              <div><strong>Version {item.versionNumber || 1}</strong><span>Current version</span></div>
                              <div><strong>{formattedModifiedDate}</strong><span>Last modified</span></div>
                            </div>
                            <div className="saved-card-actions">
                              <button className="saved-open-button" onClick={() => openDraft(item.id || item._id)} disabled={!item.id && !item._id} aria-label={`Open ${item.name || 'untitled draft'}`} >Open draft <span aria-hidden="true">→</span></button>
                              <button className="saved-history-button" onClick={() => loadDraftVersions(item.id || item._id)} disabled={!item.id && !item._id} aria-label={`View version history for ${item.name || 'untitled draft'}`}>History</button>
                              <button className="saved-duplicate-button" onClick={() => duplicateDraft(item)} disabled={(!item.id && !item._id) || duplicatingDraftId === (item.id || item._id)} aria-label={`Duplicate ${item.name || 'untitled draft'}`}>{duplicatingDraftId === (item.id || item._id) ? 'Copying…' : 'Duplicate'}</button>
                              <button className="saved-delete-button" onClick={() => deleteDraft(item)} disabled={(!item.id && !item._id) || deletingDraftId === (item.id || item._id)} aria-label={`Delete ${item.name || 'untitled draft'}`}>{deletingDraftId === (item.id || item._id) ? 'Deleting…' : 'Delete'}</button>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="saved-empty"><span className="empty-state-icon" aria-hidden="true">⌕</span><h3>No saved drafts match your search.</h3><p>Try a different draft name, semester, or status.</p></div>
                  )}
                  {historyDraftId && (
                    <section className="draft-history-panel" aria-labelledby="draft-history-title">
                      <div className="draft-history-header">
                        <div><span className="eyebrow">VERSION HISTORY</span><h2 id="draft-history-title">{savedDrafts.find((item) => (item.id || item._id) === historyDraftId)?.name || 'Draft'} history</h2><p>Restoring an earlier version creates a new version and keeps the current one.</p></div>
                        <button type="button" onClick={() => { setHistoryDraftId(''); setDraftVersions([]) }}>Close</button>
                      </div>
                      {versionsLoading ? (
                        <div className="comparison-loading" role="status"><span className="loading-spinner" aria-hidden="true" /> Loading version history…</div>
                      ) : draftVersions.length ? (
                        <div className="draft-version-list">
                          {draftVersions.map((version) => {
                            const snapshot = version.snapshot || {}
                            const currentVersion = Math.max(...draftVersions.map((item) => item.versionNumber || 1))
                            const isCurrent = (version.versionNumber || 1) === currentVersion
                            const modified = version.modifiedAtUtc ? new Date(version.modifiedAtUtc) : null
                            const modifiedLabel = modified && !Number.isNaN(modified.getTime()) ? modified.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable'
                            const status = snapshot.status || 'Draft'
                            const versionStatusClass = status.toLowerCase().includes('review') || status.toLowerCase().includes('issue') ? 'saved-status-issues' : status.toLowerCase() === 'valid' ? 'saved-status-valid' : 'saved-status-neutral'
                            return (
                              <article className={`draft-version-row${isCurrent ? ' is-current' : ''}`} key={version.versionNumber}>
                                <div className="draft-version-number"><strong>Version {version.versionNumber || 1}</strong>{isCurrent && <span>Current</span>}</div>
                                <span className="draft-version-date">Modified {modifiedLabel}</span>
                                <span className={`saved-status ${versionStatusClass}`}><i aria-hidden="true" />{status}</span>
                                <span className="draft-version-courses">{snapshot.sections?.length || 0} courses</span>
                                <button type="button" onClick={() => restoreDraftVersion(historyDraftId, version.versionNumber)} disabled={isCurrent || restoringVersion != null} aria-label={`Restore version ${version.versionNumber} from ${modifiedLabel}`}>
                                  {restoringVersion === version.versionNumber ? 'Restoring…' : 'Restore version'}
                                </button>
                              </article>
                            )
                          })}
                        </div>
                      ) : <p className="draft-history-empty">No saved versions found.</p>}
                    </section>
                  )}
                </>
              ) : draftsLoaded ? (
                <div className="empty-state">
                  <span className="empty-state-icon" aria-hidden="true">▣</span>
                  <h2>No saved drafts yet.</h2>
                  <p>Select courses, generate a schedule, then choose Save draft to keep a version here.</p>
                </div>
              ) : (
                <div className="empty-state" role="status">
                  <h2>Saved drafts could not be loaded.</h2>
                  <p>Check the connection, then try again.</p>
                  <button onClick={() => loadDrafts(true)}>Retry loading drafts</button>
                </div>
              )}
            </section>
          )}
          </div>
          <footer>
            <div className="footer-brand-lockup" aria-label="University at Albany and ScheduleSpark">
              <a className="footer-ualbany" href="https://www.albany.edu/" target="_blank" rel="noreferrer" aria-label="University at Albany website">
                <img src="https://www.albany.edu/sites/default/files/UAlbany_Minerva_Informal_Left_PurpleBlack.png" alt="University at Albany" />
              </a>
              <span className="footer-brand-divider" aria-hidden="true"></span>
              <img className="footer-schedulespark" src="/schedulespark-footer.svg" alt="ScheduleSpark" />
            </div>
            <div className="footer-copy">
              <strong>Academic scheduling workspace</strong>
              <span>{semester} · Plan courses, review conflicts, and manage schedule drafts.</span>
            </div>
          </footer>
        </main>
      </div>
    </>
  );
}
