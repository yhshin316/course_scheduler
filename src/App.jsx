import { useEffect, useMemo, useState } from "react";
import toast, { Toaster } from 'react-hot-toast'
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

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
                <th key={header}>{header}</th>
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
  const [selectedOfferingIds, setSelectedOfferingIds] = useState([]);
  const [workspace, setWorkspace] = useState({
    offerings: [],
    instructors: [],
    rooms: [],
    constraints: [],
  });
  const [draft, setDraft] = useState(null);
  const [validationStatus, setValidationStatus] = useState('pending');
  const [savedDraftId, setSavedDraftId] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [view, setView] = useState("planning");
  const [search, setSearch] = useState("");
  const [instructorSearch, setInstructorSearch] = useState("");
  const [roomSearch, setRoomSearch] = useState("");
  const [constraintSearch, setConstraintSearch] = useState("");
  const [savedDraftSearch, setSavedDraftSearch] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [planningTab, setPlanningTab] = useState("offerings");
  const [savedDrafts, setSavedDrafts] = useState([]);
  const [compareDraftAId, setCompareDraftAId] = useState('');
  const [compareDraftBId, setCompareDraftBId] = useState('');
  const [draftComparison, setDraftComparison] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [editingSection, setEditingSection] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [deletingDraftId, setDeletingDraftId] = useState(null);
  const [duplicatingDraftId, setDuplicatingDraftId] = useState(null);
  const [editingConflicts, setEditingConflicts] = useState([]);
  const [editForm, setEditForm] = useState({
    instructorId: "",
    roomId: "",
    day: "Monday",
    timeBlock: "09:00-10:15",
  });

  async function loadWorkspace() {
    setWorkspaceLoading(true);
    try {
      const nextWorkspace = await request(
        `/api/planning/workspace/${encodeURIComponent(semester)}`,
      )
      // The workspace endpoint includes enabled constraints for planning. Fetch
      // the full list separately so users can also see and re-enable disabled rules.
      const constraints = await request('/api/constraints')
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

  useEffect(() => {
    if (!draft || savedDraftId) return undefined
    const warnBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [draft, savedDraftId])

  async function loadDrafts() {
    setDraftsLoading(true)
    try {
      setSavedDrafts(await request("/api/schedules/drafts"));
      setDraftsLoaded(true)
    } catch (error) {
      setMessage(`Could not load saved drafts: ${error.message}`);
    } finally {
      setDraftsLoading(false)
    }
  }

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
      await loadDrafts()

      toast.dismiss(toastId)
      toast.success('Draft saved successfully.')
    } catch (error) {
      toast.dismiss(toastId)
      toast.error(`Could not save draft: ${error.message}`)
    }
  }

  async function openDraft(id) {
    try {
      setDraft(await request(`/api/schedules/drafts/${id}`));
      setSavedDraftId(id)
      setValidationStatus('pending')
      setView("schedule");
      setMessage("Saved draft opened.");
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

    const item = confirmation.item
    const id = item?.id || item?._id
    if (!id) return
    setConfirmation(null)
    setDeletingDraftId(id)
    try {
      await request(`/api/schedules/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setSavedDrafts((current) => current.filter((saved) => (saved.id || saved._id) !== id))
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
    const blocks = Array.isArray(item.availableBlocks) ? item.availableBlocks.join(' ') : (item.availableBlocks || '')
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
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const scheduledCount = draft?.sections?.length || 0
  const assignedCount = draft?.sections?.filter((section) => section.instructorId && section.roomId && section.day && section.timeBlock).length || 0
  const instructorWorkload = useMemo(() => workspace.instructors.map((instructor) => {
    const assignments = (draft?.sections || []).filter((section) => section.instructorId && section.instructorId === instructor.id)
    const maximumLoad = Number(instructor.maximumCourseLoad ?? 0)
    return { instructor, assignments, overloaded: assignments.length > maximumLoad }
  }), [workspace.instructors, draft?.sections])

  async function generateDraft() {
    if (!selectedOfferingIds.length) {
      toast.error('Select at least one course offering to generate a draft.')
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
      setView('schedule')

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
        setView('schedule')
      } else {
        toast.error(`${result.errors.length} conflict(s) found.`)
        setView('conflicts')
      }
    } catch (error) {
      toast.dismiss(toastId)
      toast.error(`Validation failed: ${error.message}`)
    }
  }

  function startEdit(section) {
    setEditingSection(section);
    setEditingConflicts([]);
    setEditForm({
      instructorId: section.instructorId || "",
      roomId: section.roomId || "",
      day: section.day || "Monday",
      timeBlock: section.timeBlock || "09:00-10:15",
    });
  }

  async function saveSectionEdit() {
    if (!draft || !editingSection) {
      toast.error('Please select an assignment first.')
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
      setSavedDraftId(null)
      setValidationStatus(result.isValid ? 'valid' : 'issues')
      setConflicts(result.errors || [])
      setEditingConflicts(result.isValid ? [] : (result.errors || []))

      toast.dismiss(toastId)

      if (result.isValid) {
        setEditingSection(null)
        toast.success('Assignment updated successfully.')
        setView('schedule')
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
    <div className="modal-backdrop" onClick={closeEditModal}>
      <div
        className="edit-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="edit-modal-header">
          <div>
            <span className="eyebrow">SCHEDULE ASSIGNMENT</span>
            <h2>Edit {editingSection.courseCode}</h2>
            <p>Update the assignment and validate the change.</p>
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

        <div className="current-assignment" aria-label="Current assignment values">
          <strong>Current assignment</strong>
          <span><b>Instructor</b>{editingSection.instructorName || 'Unassigned'}</span>
          <span><b>Room</b>{editingSection.roomNumber || 'Unassigned'}</span>
          <span><b>Day</b>{editingSection.day || 'Unassigned'}</span>
          <span><b>Time</b>{editingSection.timeBlock || 'Unassigned'}</span>
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
              onChange={(event) =>
                setEditForm({
                  ...editForm,
                  day: event.target.value,
                })
              }
            >
              {days.map((day) => (
                <option value={day} key={day}>
                  {day}
                </option>
              ))}
            </select>
          </label>

          <label>
            Time block
            <select
              value={editForm.timeBlock}
              onChange={(event) =>
                setEditForm({
                  ...editForm,
                  timeBlock: event.target.value,
                })
              }
            >
              {[
                '09:00-10:15',
                '10:30-11:45',
                '13:00-14:15',
                '15:00-16:15',
              ].map((time) => (
                <option value={time} key={time}>
                  {time}
                </option>
              ))}
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
          <section className={`confirmation-modal${confirmation.kind === 'deleteDraft' ? ' delete-confirmation' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-description">
            <div className="confirmation-heading">
              <span className="confirmation-icon" aria-hidden="true">
                {confirmation.kind === 'deleteDraft' ? (
                  <svg viewBox="0 0 24 24" focusable="false"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" /></svg>
                ) : '↶'}
              </span>
              <div>
                <span className="confirmation-eyebrow">{confirmation.kind === 'deleteDraft' ? 'DELETE SAVED DRAFT' : 'UNSAVED ASSIGNMENT'}</span>
                <h2 id="confirmation-title">{confirmation.kind === 'deleteDraft' ? 'Delete this draft?' : 'Discard unsaved changes?'}</h2>
              </div>
            </div>
            <p id="confirmation-description">
              {confirmation.kind === 'deleteDraft'
                ? 'This will permanently remove the saved schedule and its assignments.'
                : 'Your assignment changes will be lost.'}
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
            <div className="confirmation-actions">
              <button type="button" className="confirmation-cancel" onClick={() => setConfirmation(null)}>Cancel</button>
              <button type="button" className="confirmation-destructive" onClick={confirmAction}>
                {confirmation.kind === 'deleteDraft' ? 'Delete draft' : 'Discard changes'}
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <b>S</b>
            <div>
              <strong>ScheduleSpark</strong>
              <small>Academic planning assistant</small>
            </div>
          </div>
          <nav>
            <button
              className={view === "planning" ? "active" : ""}
              onClick={() => setView("planning")}
            >
              ▦ <span>Planning Workspace</span>
            </button>
            <button
              className={view === "schedule" ? "active" : ""}
              onClick={() => setView("schedule")}
            >
              ▤ <span>Schedule Builder</span>
            </button>
            <button
              className={view === "conflicts" ? "active" : ""}
              onClick={() => setView("conflicts")}
            >
              ⚠ <span>Conflict Review</span>
              {conflicts.length > 0 && <em>{conflicts.length}</em>}
            </button>
            <button
              className={view === "saved" ? "active" : ""}
              onClick={() => {
                setView("saved");
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
              <h1>
                {view === "planning"
                  ? "Planning Workspace"
                  : view === "schedule"
                    ? "Schedule Builder"
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
                <select
                  value={semester}
                  onChange={(e) => {
                    setSelectedOfferingIds([])
                    setSemester(e.target.value)
                  }}
                >
                  <option>Fall 2026</option>
                  <option>Spring 2027</option>
                </select>
              </label>
              <button onClick={loadWorkspace} disabled={workspaceLoading}>{workspaceLoading ? 'Loading…' : '↻ Refresh'}</button>
            </div>
          </header>
          <WorkflowProgress
            activeStep={view}
            completedSteps={[
              ...(connected ? ['planning'] : []),
              ...(draft ? ['schedule'] : []),
              ...(validationStatus !== 'pending' ? ['conflicts'] : []),
              ...(savedDraftId ? ['saved'] : []),
            ]}
            onSelect={setView}
          />
          <section className="stats">
            <Stat label="Course offerings" value={workspace.offerings.length} />
            <Stat label="Instructors" value={workspace.instructors.length} />
            <Stat label="Rooms and labs" value={workspace.rooms.length} />
            <Stat
              label="Open conflicts"
              value={conflicts.length}
              danger={conflicts.length > 0}
            />
          </section>
          {view === "planning" && (
            <>
              <div className="planning-tabs">
                {[
                  ["offerings", "Course Offerings"],
                  ["instructors", "Instructors"],
                  ["rooms", "Rooms & Labs"],
                  ["constraints", "Constraints"],
                ].map(([key, label]) => (
                  <button
                    className={planningTab === key ? "selected" : ""}
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
                        onClick={generateDraft}
                        disabled={loading || selectedOfferingIds.length === 0}
                      >
                        ✦ Generate selected draft ({selectedOfferingIds.length})
                      </button>
                    </div>
                    <div className="toolbar">
                      <input
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
                          <th>Course</th>
                          <th>Title</th>
                          <th>Predicted enrollment</th>
                          <th>Type</th>
                          <th>Status</th>
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
                        const qualifiedCourses = Array.isArray(item.qualifiedCourses) ? item.qualifiedCourses : (item.qualifiedCourses ? [item.qualifiedCourses] : [])
                        const availableBlocks = Array.isArray(item.availableBlocks) ? item.availableBlocks : (item.availableBlocks ? [item.availableBlocks] : [])
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
                              <span className="instructor-section-label">AVAILABLE BLOCKS <small>{availableBlocks.length}</small></span>
                              {availableBlocks.length ? <div className="availability-list">{availableBlocks.map((block, index) => <span className="availability-block" key={`${block}-${index}`}><i aria-hidden="true" />{block}</span>)}</div> : <p className="instructor-missing">Availability not specified</p>}
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
                                <div><h3>{item.name || 'Unnamed rule'}</h3><span className="constraint-type">{item.type || 'General rule'}</span></div>
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
                  <button onClick={validateDraft} disabled={!draft || loading}>Validate</button>
                  <button onClick={saveDraft} disabled={!draft || loading}>Save draft</button>
                  <button className="primary" onClick={generateDraft} disabled={loading}>✦ Regenerate</button>
                </div>
              </div>
              {draft ? (
                <>
                <div className="schedule-summary">
                  <span><strong>{scheduledCount}</strong> assignments</span>
                  <span><strong>{assignedCount}</strong> fully assigned</span>
                  <span className={`validation-pill ${validationStatus}`}>{validationStatus === 'valid' ? '✓ Validated' : validationStatus === 'issues' ? '⚠ Needs review' : '○ Not validated'}</span>
                  <small>Select a card to edit instructor, room, day, or time.</small>
                </div>
                <div className="calendar">
                  {days.map((day) => (
                    <div className="day" key={day}>
                      <h3><span>{day}</span><span className="day-count">{(draft.sections || []).filter((section) => section.day === day).length}</span></h3>
                      {(draft.sections || []).filter((s) => s.day === day)
                        .map((s, i) => (
                          <button className={`course ${s.isLab ? 'lab' : ''}`} key={`${s.courseCode}-${i}`} onClick={() => startEdit(s)} aria-label={`Edit ${s.courseCode} ${s.isLab ? 'laboratory' : 'lecture'} assignment`}>
                            <span className="course-topline"><b>{s.courseCode}</b><span className="course-kind">{s.isLab ? "Lab" : "Lecture"}</span></span>
                            <strong className="course-time">{s.timeBlock || "Time unassigned"}</strong>
                            <span className="course-meta">⌖ {s.roomNumber || "Room unassigned"}</span>
                            <span className="course-meta">◉ {s.instructorName || "Instructor unassigned"}</span>
                            <span className="course-hint">Click to edit <span aria-hidden="true">↗</span></span>
                          </button>
                        ))}
                      {!draft.sections?.some((section) => section.day === day) && <p className="day-empty">No assignments</p>}
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
                        <tr><th>Instructor</th><th>Assigned courses</th><th>Maximum load</th><th>Status</th><th>Actions</th></tr>
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
                  <h2>No draft exists. Generate a draft to begin.</h2>
                  <p>Build a schedule draft from your planning inputs.</p>
                  <button className="primary" onClick={generateDraft} disabled={loading || workspaceLoading}>✦ Generate draft</button>
                </div>
              )}
            </section>
          )}
          {view === "conflicts" && (
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h2>Conflict review</h2>
                  <p>Required constraint violations from the selected draft.</p>
                </div>
                <button onClick={validateDraft} disabled={!draft}>
                  Run validation
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
                        {affectedSections.length > 0 ? (
                          <div className="conflict-assignments">
                            {affectedSections.map((section, sectionIndex) => (
                              <div className="conflict-assignment" key={`${section.courseCode}-${sectionIndex}`}>
                                <div className="assignment-details">
                                  <strong>{section.courseCode} <small>Current assignment</small></strong>
                                  <span><b>Day / time</b>{section.day || 'Unassigned'} · {section.timeBlock || 'Unassigned'}</span>
                                  <span><b>Room</b>{section.roomNumber || 'Unassigned'}</span>
                                  <span><b>Instructor</b>{section.instructorName || 'Unassigned'}</span>
                                </div>
                                <button className="conflict-edit-button" onClick={() => startEdit(section)} aria-label={`Edit assignment for ${section.courseCode}`}>Edit assignment <span aria-hidden="true">↗</span></button>
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
                  <h2>Saved schedule drafts</h2>
                  <p>Reopen a saved version to review assignments and continue planning.</p>
                </div>
                <div className="saved-header-actions">
                  <span className="saved-count">{filteredSavedDrafts.length} <small>of {savedDrafts.length} drafts</small></span>
                  <button onClick={loadDrafts} disabled={draftsLoading}>{draftsLoading ? 'Refreshing…' : '↻ Refresh'}</button>
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
                              <div><strong>{formattedModifiedDate}</strong><span>Last modified</span></div>
                            </div>
                            <div className="saved-card-actions">
                              <button className="saved-open-button" onClick={() => openDraft(item.id || item._id)} disabled={!item.id && !item._id}>Open draft <span aria-hidden="true">→</span></button>
                              <button className="saved-duplicate-button" onClick={() => duplicateDraft(item)} disabled={(!item.id && !item._id) || duplicatingDraftId === (item.id || item._id)}>{duplicatingDraftId === (item.id || item._id) ? 'Copying…' : 'Duplicate'}</button>
                              <button className="saved-delete-button" onClick={() => deleteDraft(item)} disabled={(!item.id && !item._id) || deletingDraftId === (item.id || item._id)}>{deletingDraftId === (item.id || item._id) ? 'Deleting…' : 'Delete'}</button>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="saved-empty"><span className="empty-state-icon" aria-hidden="true">⌕</span><h3>No saved drafts match your search.</h3><p>Try a different draft name, semester, or status.</p></div>
                  )}
                </>
              ) : draftsLoaded ? (
                <div className="empty-state">
                  <span className="empty-state-icon" aria-hidden="true">▣</span>
                  <h2>No saved drafts yet.</h2>
                  <p>Generate a schedule and save it to keep a version here.</p>
                </div>
              ) : (
                <div className="empty-state" role="status">
                  <h2>Saved drafts could not be loaded.</h2>
                  <p>Check the connection, then try again.</p>
                  <button onClick={loadDrafts}>Retry loading drafts</button>
                </div>
              )}
            </section>
          )}
          <footer>
            ScheduleSpark · Team D · Delta{" "}
            <span>React JavaScript + ASP.NET Core + MongoDB</span>
          </footer>
        </main>
      </div>
    </>
  );
}
