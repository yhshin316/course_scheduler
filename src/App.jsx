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

function Stat({ label, value, danger }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={danger ? "danger-text" : ""}>{value}</strong>
    </div>
  );
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
  const [workspace, setWorkspace] = useState({
    offerings: [],
    instructors: [],
    rooms: [],
    constraints: [],
  });
  const [draft, setDraft] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [view, setView] = useState("planning");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [planningTab, setPlanningTab] = useState("offerings");
  const [savedDrafts, setSavedDrafts] = useState([]);
  const [editingSection, setEditingSection] = useState(null);
  const [editForm, setEditForm] = useState({
    instructorId: "",
    roomId: "",
    day: "Monday",
    timeBlock: "09:00-10:15",
  });

  async function loadWorkspace() {
    setLoading(true);
    try {
      setWorkspace(
        await request(
          `/api/planning/workspace/${encodeURIComponent(semester)}`,
        ),
      );
      setConnected(true);
      setMessage(`Planning data loaded for ${semester}.`);
    } catch (error) {
      setConnected(false);
      setMessage(`Backend connection failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadWorkspace();
  }, [semester]);

  async function loadDrafts() {
    try {
      setSavedDrafts(await request("/api/schedules/drafts"));
    } catch (error) {
      setMessage(`Could not load saved drafts: ${error.message}`);
    }
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
      setView("schedule");
      setMessage("Saved draft opened.");
    } catch (error) {
      setMessage(`Could not open draft: ${error.message}`);
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
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

  async function generateDraft() {
    const toastId = toast.loading('Generating schedule draft...')

    try {
      setLoading(true)

      const generatedDraft = await request('/api/schedules/generate', {
        method: 'POST',
        body: JSON.stringify({
          semester,
          offeringIds: [],
        }),
      })

      setDraft(generatedDraft)
      setConflicts([])
      setView('schedule')

      toast.dismiss(toastId)
      toast.success('Schedule draft generated successfully.')
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
      setConflicts(result.errors || [])
      setEditingSection(null)

      toast.dismiss(toastId)

      if (result.isValid) {
        toast.success('Assignment updated successfully.')
        setView('schedule')
      } else {
        toast.error(
          `${result.errors?.length || 1} scheduling conflict(s) found.`
        )
        setView('conflicts')
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
    <div className="modal-backdrop" onClick={() => setEditingSection(null)}>
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
            onClick={() => setEditingSection(null)}
            aria-label="Close"
          >
            ×
          </button>
        </div>

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
                  {item.roomNumber} · Capacity {item.capacity}
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
            onClick={() => setEditingSection(null)}
          >
            Cancel
          </button>

          <button
            className="primary"
            onClick={saveSectionEdit}
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save and validate'}
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
                  onChange={(e) => setSemester(e.target.value)}
                >
                  <option>Fall 2026</option>
                  <option>Spring 2027</option>
                </select>
              </label>
              <button onClick={loadWorkspace}>↻ Refresh</button>
            </div>
          </header>
          {message && <div className="notice">{message}</div>}
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
                        disabled={loading}
                      >
                        ✦ Generate draft
                      </button>
                    </div>
                    <div className="toolbar">
                      <input
                        placeholder="Search by course code or title"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <span>{offerings.length} offering(s)</span>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>Course</th>
                          <th>Title</th>
                          <th>Predicted enrollment</th>
                          <th>Type</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {offerings.length ? (
                          offerings.map((item) => (
                            <tr key={item.id}>
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
                            <td colSpan="5" className="empty">
                              No semester offerings found.
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
                <ResourceTable
                  title="Instructor availability"
                  description="Qualifications, availability, and teaching preferences."
                  headers={[
                    "Name",
                    "Qualified courses",
                    "Available blocks",
                    "Maximum load",
                  ]}
                  rows={workspace.instructors.map((item) => [
                    item.name,
                    item.qualifiedCourses?.join(", "),
                    item.availableBlocks?.join("; "),
                    item.maximumCourseLoad,
                  ])}
                />
              )}
              {planningTab === "rooms" && (
                <ResourceTable
                  title="Rooms and laboratories"
                  description="Capacity, room type, equipment, and available blocks."
                  headers={["Room", "Building", "Capacity", "Type", "Equipment"]}
                  rows={workspace.rooms.map((item) => [
                    item.roomNumber,
                    item.building,
                    item.capacity,
                    item.roomType,
                    item.equipment?.join(", "),
                  ])}
                />
              )}
              {planningTab === "constraints" && (
                <ResourceTable
                  title="Scheduling constraints"
                  description="Required rules and preferences used by the scheduler."
                  headers={["Name", "Type", "Priority", "Enabled", "Description"]}
                  rows={workspace.constraints.map((item) => [
                    item.name,
                    item.type,
                    item.priority,
                    item.enabled ? "Yes" : "No",
                    item.description,
                  ])}
                />
              )}
            </>
          )}
          {view === "schedule" && (
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h2>{draft?.name || "Schedule draft"}</h2>
                  <p>Lecture and laboratory assignments for {semester}</p>
                </div>
                <div>
                  <button onClick={validateDraft} disabled={!draft}>
                    Validate draft
                  </button>
                  <button onClick={saveDraft} disabled={!draft}>
                    Save draft
                  </button>
                  <button
                    onClick={() =>
                      draft?.sections?.[0] && startEdit(draft.sections[0])
                    }
                    disabled={!draft}
                  >
                    Edit first assignment
                  </button>
                  <button className="primary" onClick={generateDraft}>
                    Regenerate
                  </button>
                </div>
              </div>
              {draft ? (
                <div className="calendar">
                  {days.map((day) => (
                    <div className="day" key={day}>
                      <h3>{day}</h3>
                      {(draft.sections || [])
                        .filter((s) => s.day === day)
                        .map((s, i) => (
                          <div className="course" key={`${s.courseCode}-${i}`}>
                            <b>{s.courseCode}</b>
                            <span>{s.timeBlock || "Time unassigned"}</span>
                            <small>
                              {s.isLab ? "Laboratory" : "Lecture"} ·{" "}
                              {s.roomNumber || "Room unassigned"} ·{" "}
                              {s.instructorName || "Instructor unassigned"}
                            </small>{" "}
                            <button
                              className="course-edit-button"
                              onClick={() => startEdit(s)}
                            >
                              Edit assignment
                            </button>
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <h2>No draft generated yet</h2>
                  <p>Generate a draft from the Planning Workspace.</p>
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
                conflicts.map((item, i) => (
                  <div className="conflict detailed-conflict" key={i}>
                    <b>!</b>
                    <div>
                      <strong>{item.category || "Scheduling conflict"}</strong>
                      <small>
                        Course: {item.courseCode || "Multiple courses"} ·
                        Severity: {item.severity || "Required"}
                      </small>
                      <span>{item.message || item}</span>
                      {item.suggestedAction && (
                        <em>Suggested action: {item.suggestedAction}</em>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <h2>No conflicts to display</h2>
                  <p>Generate or validate a draft to see issues here.</p>
                </div>
              )}
            </section>
          )}
          {view === "saved" && (
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h2>Saved schedule drafts</h2>
                  <p>
                    Open a previous schedule version and continue reviewing it.
                  </p>
                </div>
                <button onClick={loadDrafts}>↻ Refresh drafts</button>
              </div>
              {savedDrafts.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Draft name</th>
                      <th>Semester</th>
                      <th>Status</th>
                      <th>Violations</th>
                      <th>Created</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedDrafts.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <b>{item.name}</b>
                        </td>
                        <td>{item.semester}</td>
                        <td>{item.status}</td>
                        <td>{item.requiredViolationCount}</td>
                        <td>
                          {item.createdAtUtc
                            ? new Date(item.createdAtUtc).toLocaleString()
                            : "—"}
                        </td>
                        <td>
                          <button onClick={() => openDraft(item.id)}>Open</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty-state">
                  <h2>No saved drafts</h2>
                  <p>Generate a schedule and click Save draft.</p>
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
