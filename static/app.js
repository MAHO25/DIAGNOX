/**
 * =============================================================================
 * EXPERT-DIAG™ // INDUSTRIAL KBS FAULT DIAGNOSIS ENGINE
 * Client-Side Controller & Presentation Logic
 * =============================================================================
 */

// ── Application Global State ──
const API_BASE = '';
let selectedMachine = null;
let allSymptoms = [];
let selectedSymptoms = new Set();
let cachedMachines = [];

// ── Technical Metadata & SVG Icons per Equipment Frame ──
const EQUIPMENT_META = {
    motor: {
        standard: 'IEC 60034-1 / NEMA MG-1',
        category: 'Rotary Electro-Mechanical',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="12" cy="12" r="9"></circle>
            <circle cx="12" cy="12" r="4"></circle>
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3"></path>
            <path d="m5.6 5.6 2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"></path>
        </svg>`
    },
    pump: {
        standard: 'ISO 5199 / ANSI B73.1',
        category: 'Centrifugal Fluid Transport',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M12 2v6m0 8v6"></path>
            <circle cx="12" cy="12" r="8"></circle>
            <path d="M12 12a3 3 0 1 0 3-3"></path>
            <path d="M20 12h2M2 12h2"></path>
        </svg>`
    },
    gearbox: {
        standard: 'AGMA 6013 / ISO 6336',
        category: 'Mechanical Power Transmission',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="9" cy="9" r="4"></circle>
            <path d="M9 1v2M9 15v2M1 9h2M15 9h2"></path>
            <circle cx="17" cy="17" r="3"></circle>
            <path d="M17 11v1M17 21v2M11 17h1M21 17h2"></path>
        </svg>`
    },
    compressor: {
        standard: 'ISO 1217 / CAGI PN2',
        category: 'Pneumatic Compression Systems',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <rect x="3" y="6" width="18" height="12" rx="3"></rect>
            <circle cx="9" cy="12" r="2.5"></circle>
            <path d="M15 9v6M18 10v4M6 10v4"></path>
            <path d="M9 2v4M15 2v4"></path>
        </svg>`
    }
};

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    loadEquipmentFrames();
    setupSearchListener();
    setupTelemetryListeners();
});

/**
 * Ingests machine frames & domain statistics from Flask REST API.
 */
async function loadEquipmentFrames() {
    const grid = document.getElementById('machineGrid');
    
    try {
        const res = await fetch(`${API_BASE}/api/machines`);
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        cachedMachines = await res.json();

        // Update Global KPIs
        let totalRules = 0;
        let totalSymptoms = 0;

        cachedMachines.forEach(m => {
            totalRules += m.rule_count || 0;
            totalSymptoms += m.symptom_count || 0;
        });

        document.getElementById('kpiMachines').textContent = cachedMachines.length;
        document.getElementById('kpiRules').textContent = totalRules;
        document.getElementById('kpiSymptoms').textContent = totalSymptoms;

        // Render Equipment Cards
        grid.innerHTML = '';
        cachedMachines.forEach(mach => {
            const meta = EQUIPMENT_META[mach.id] || {
                standard: 'ISO Standard Industrial Specification',
                category: 'General Industrial Equipment',
                svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"></circle></svg>'
            };

            const card = document.createElement('div');
            card.className = 'equipment-card';
            card.setAttribute('data-id', mach.id);
            card.onclick = () => selectMachine(mach.id, mach.name);

            card.innerHTML = `
                <div>
                    <div class="equip-card-top">
                        <div class="equip-icon-wrap">${meta.svg}</div>
                        <span class="equip-status-chip">FRAME LOADED</span>
                    </div>
                    <div class="equip-card-body">
                        <h3>${escapeHtml(mach.name)}</h3>
                        <div class="equip-standard">${meta.standard}</div>
                    </div>
                </div>
                <div class="equip-metrics">
                    <div class="metric-col">
                        <span class="metric-num">${mach.rule_count}</span>
                        <span class="metric-label">Rules</span>
                    </div>
                    <div class="metric-col">
                        <span class="metric-num">${mach.symptom_count}</span>
                        <span class="metric-label">Symptoms</span>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });

    } catch (err) {
        console.error('Frame ingestion error:', err);
        grid.innerHTML = `
            <div class="loading-state">
                <p style="color: var(--critical-red);">⚠️ Failed to connect to KBS Backend server.</p>
                <small style="color: var(--text-muted);">Ensure app.py is active on http://localhost:5000</small>
            </div>
        `;
    }
}

// ============================================================================
// STEP 1: EQUIPMENT SELECTION
// ============================================================================
async function selectMachine(machineId, machineName) {
    selectedMachine = machineId;
    selectedSymptoms.clear();

    // Visual Card Selection
    document.querySelectorAll('.equipment-card').forEach(card => {
        card.classList.toggle('selected', card.getAttribute('data-id') === machineId);
    });

    // Update Progress Stepper
    setStepActive(2);

    // Label header
    document.getElementById('selectedMachineName').textContent = machineName;

    // Unhide subsequent panels
    document.getElementById('stepSymptoms').classList.remove('hidden');
    document.getElementById('stepSensors').classList.remove('hidden');
    document.getElementById('actionBar').classList.remove('hidden');
    document.getElementById('stepResults').classList.add('hidden');

    // Reset search
    const searchInput = document.getElementById('symptomSearch');
    if (searchInput) searchInput.value = '';
    document.getElementById('btnClearSearch').classList.add('hidden');

    // Ingest Symptoms
    await loadSymptomsForMachine(machineId);

    // Smooth scroll to step 2
    document.getElementById('stepSymptoms').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================================
// STEP 2: SYMPTOM ASSESSMENT
// ============================================================================
async function loadSymptomsForMachine(machineId) {
    const list = document.getElementById('symptomList');
    list.innerHTML = `
        <div class="loading-state" style="grid-column: 1 / -1;">
            <div class="pulse-ring"></div>
            <p>Querying observable symptoms from frame slots...</p>
        </div>
    `;
    updateSelectedCount();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
        const res = await fetch(`${API_BASE}/api/machines/${machineId}/symptoms`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        allSymptoms = await res.json();

        renderSymptomChecklist(allSymptoms);
    } catch (err) {
        clearTimeout(timeoutId);
        console.error('Failed loading symptoms:', err);
        list.innerHTML = `
            <div class="loading-state" style="grid-column: 1 / -1; color: var(--critical-red);">
                <p>Failed to retrieve symptoms (${escapeHtml(err.name === 'AbortError' ? 'Server query timed out' : err.message)}).</p>
                <button type="button" class="btn-ghost" onclick="loadSymptomsForMachine('${machineId}')" style="margin-top: 0.5rem; display: inline-block;">Retry Query</button>
            </div>
        `;
    }
}

function renderSymptomChecklist(symptoms) {
    const container = document.getElementById('symptomList');
    container.innerHTML = '';

    if (!symptoms || symptoms.length === 0) {
        container.innerHTML = `<div class="loading-state" style="grid-column: 1 / -1;">No symptoms match your query.</div>`;
        return;
    }

    symptoms.forEach(symptom => {
        const isChecked = selectedSymptoms.has(symptom);

        const card = document.createElement('label');
        card.className = `symptom-checkbox-card ${isChecked ? 'checked' : ''}`;

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = isChecked;
        input.onchange = () => {
            if (input.checked) {
                selectedSymptoms.add(symptom);
                card.classList.add('checked');
            } else {
                selectedSymptoms.delete(symptom);
                card.classList.remove('checked');
            }
            updateSelectedCount();
        };

        const span = document.createElement('span');
        span.className = 'symptom-text';
        span.textContent = symptom;

        card.appendChild(input);
        card.appendChild(span);
        container.appendChild(card);
    });
}

function updateSelectedCount() {
    document.getElementById('selectedCount').textContent = selectedSymptoms.size;
}

function setupSearchListener() {
    const input = document.getElementById('symptomSearch');
    const clearBtn = document.getElementById('btnClearSearch');

    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        clearBtn.classList.toggle('hidden', q.length === 0);

        if (!q) {
            renderSymptomChecklist(allSymptoms);
        } else {
            const filtered = allSymptoms.filter(s => s.toLowerCase().includes(q));
            renderSymptomChecklist(filtered);
        }
    });

    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.classList.add('hidden');
        renderSymptomChecklist(allSymptoms);
        input.focus();
    });
}

function selectAllVisibleSymptoms() {
    const input = document.getElementById('symptomSearch');
    const q = input.value.trim().toLowerCase();
    const visible = q ? allSymptoms.filter(s => s.toLowerCase().includes(q)) : allSymptoms;

    visible.forEach(s => selectedSymptoms.add(s));
    renderSymptomChecklist(visible);
    updateSelectedCount();
}

function clearSelectedSymptoms() {
    selectedSymptoms.clear();
    const input = document.getElementById('symptomSearch');
    const q = input.value.trim().toLowerCase();
    const visible = q ? allSymptoms.filter(s => s.toLowerCase().includes(q)) : allSymptoms;

    renderSymptomChecklist(visible);
    updateSelectedCount();
}

// ============================================================================
// STEP 3: SCADA TELEMETRY PRESETS
// ============================================================================
function applyTelemetryPreset(presetKey) {
    const air     = document.getElementById('sensorAirTemp');
    const proc    = document.getElementById('sensorProcessTemp');
    const speed   = document.getElementById('sensorSpeed');
    const torque  = document.getElementById('sensorTorque');
    const wear    = document.getElementById('sensorWear');

    if (!air || !proc || !speed || !torque || !wear) return;

    switch (presetKey) {
        case 'normal':
            air.value = '298.5';
            proc.value = '303.2';
            speed.value = '1520';
            torque.value = '41.2';
            wear.value = '45';
            break;
        case 'hdf':
            // process_temp > 310K AND (process_temp - air_temp) > 8.6K
            air.value = '296.0';
            proc.value = '314.5'; // delta = 18.5K
            speed.value = '1480';
            torque.value = '46.0';
            wear.value = '80';
            break;
        case 'osf':
            // torque > 60Nm AND tool_wear > 200min
            air.value = '300.0';
            proc.value = '308.0';
            speed.value = '1420';
            torque.value = '67.5';
            wear.value = '218';
            break;
        case 'clear':
        default:
            air.value = '';
            proc.value = '';
            speed.value = '';
            torque.value = '';
            wear.value = '';
            break;
    }

    // Trigger immediate ML telemetry risk evaluation on preset selection
    checkLiveMlTelemetry();
}

/**
 * Attaches real-time listeners to telemetry input fields to trigger ML prediction.
 */
function setupTelemetryListeners() {
    const sensorIds = ['sensorAirTemp', 'sensorProcessTemp', 'sensorSpeed', 'sensorTorque', 'sensorWear'];
    let debounceTimer = null;
    sensorIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(checkLiveMlTelemetry, 300);
            });
        }
    });
}

/**
 * Executes real-time Machine Learning prediction via POST /api/ml/predict.
 */
async function checkLiveMlTelemetry() {
    const telemetry = getCollectedSensorTelemetry();
    const meterEl = document.getElementById('mlLiveMeter');
    const titleEl = document.getElementById('mlLiveTitle');
    const metaEl = document.getElementById('mlLiveMeta');

    if (!meterEl || !titleEl || !metaEl) return;

    if (!telemetry) {
        meterEl.className = 'ml-live-meter nominal';
        titleEl.innerHTML = '🤖 Real-Time AI Telemetry Predictor: <strong>Nominal Operation</strong>';
        metaEl.innerHTML = 'Confidence: <strong>99.9%</strong> | Risk: <span class="badge-risk-low">LOW</span>';
        return;
    }

    try {
        const payload = {
            machine_type: selectedMachine || 'motor',
            sensor_data: telemetry
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const res = await fetch(`${API_BASE}/api/ml/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) return;
        const data = await res.json();

        if (data.failure_risk) {
            const isCrit = data.risk_level === 'CRITICAL';
            meterEl.className = `ml-live-meter ${isCrit ? 'critical' : 'warning'}`;
            titleEl.innerHTML = `⚠️ <strong>AI Telemetry Anomaly Detected</strong> (${isCrit ? 'Critical Breakdown Hazard' : 'Operating Threshold Exceeded'})`;
            metaEl.innerHTML = `Confidence: <strong>${data.confidence_pct}%</strong> | Risk: <span class="badge-risk-${isCrit ? 'critical' : 'high'}">${data.risk_level}</span>`;
        } else {
            meterEl.className = 'ml-live-meter nominal';
            titleEl.innerHTML = '✅ Real-Time AI Telemetry Predictor: <strong>Nominal Operation</strong>';
            metaEl.innerHTML = `Confidence: <strong>${data.confidence_pct}%</strong> | Risk: <span class="badge-risk-low">LOW</span>`;
        }
    } catch (err) {
        console.warn('ML live check error:', err);
    }
}

function getCollectedSensorTelemetry() {
    const airEl   = document.getElementById('sensorAirTemp');
    const procEl  = document.getElementById('sensorProcessTemp');
    const speedEl = document.getElementById('sensorSpeed');
    const torqEl  = document.getElementById('sensorTorque');
    const wearEl  = document.getElementById('sensorWear');

    const air   = airEl ? airEl.value.trim() : '';
    const proc  = procEl ? procEl.value.trim() : '';
    const speed = speedEl ? speedEl.value.trim() : '';
    const torq  = torqEl ? torqEl.value.trim() : '';
    const wear  = wearEl ? wearEl.value.trim() : '';

    const hasData = [air, proc, speed, torq, wear].some(v => v !== '');
    if (!hasData) return null;

    const data = {};
    if (air && !isNaN(parseFloat(air)))       data.air_temp = parseFloat(air);
    if (proc && !isNaN(parseFloat(proc)))     data.process_temp = parseFloat(proc);
    if (speed && !isNaN(parseFloat(speed)))   data.rotational_speed = parseFloat(speed);
    if (torq && !isNaN(parseFloat(torq)))     data.torque = parseFloat(torq);
    if (wear && !isNaN(parseFloat(wear)))     data.tool_wear = parseFloat(wear);

    return data;
}

// ============================================================================
// STEP 4: FORWARD CHAINING INFERENCE EXECUTION
// ============================================================================
async function runDiagnosis() {
    if (!selectedMachine) {
        alert('Please select an equipment frame first.');
        return;
    }

    const telemetry = getCollectedSensorTelemetry();

    if (selectedSymptoms.size === 0 && !telemetry) {
        alert('Please check at least one observed symptom or enter sensor telemetry data.');
        return;
    }

    const resultsSection = document.getElementById('stepResults');
    const container = document.getElementById('resultsContainer');
    const btn = document.getElementById('btnDiagnose');

    // UI state updates
    resultsSection.classList.remove('hidden');
    setStepActive(4);

    container.innerHTML = `
        <div class="loading-state">
            <div class="pulse-ring"></div>
            <p>Executing Forward Chaining (Modus Ponens) Match-Resolve-Act Cycle...</p>
            <small style="color: var(--text-muted);">Propagating certainty factors and applying ISO safety conflict resolution...</small>
        </div>
    `;

    btn.disabled = true;
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
        const payload = {
            machine_type: selectedMachine,
            symptoms: Array.from(selectedSymptoms),
            sensor_data: telemetry
        };

        const res = await fetch(`${API_BASE}/api/diagnose`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }

        const diagnoses = await res.json();
        renderDiagnosisAudit(diagnoses);

    } catch (err) {
        console.error('Diagnosis failed:', err);
        container.innerHTML = `
            <div class="empty-results-box" style="border-color: var(--critical-border);">
                <div style="color: var(--critical-red); font-weight: 700; margin-bottom: 0.5rem;">Diagnostic Inference Failure</div>
                <p style="color: var(--text-secondary);">${escapeHtml(err.message)}</p>
            </div>
        `;
    } finally {
        btn.disabled = false;
    }
}

// ============================================================================
// RESULTS PRESENTATION & AUDIT TRAIL
// ============================================================================
function renderDiagnosisAudit(diagnoses) {
    const container = document.getElementById('resultsContainer');

    if (!diagnoses || diagnoses.length === 0) {
        container.innerHTML = `
            <div class="empty-results-box">
                <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <div style="color: var(--text-primary); font-weight: 700; font-size: 1.1rem; margin-bottom: 0.35rem;">No Conclusive Failure Mode Inferred</div>
                <p>The combination of observed symptoms did not satisfy any rule antecedent for this machine frame.</p>
                <small style="color: var(--text-muted); display: block; margin-top: 0.5rem;">Try selecting additional symptoms or providing telemetry measurements.</small>
            </div>
        `;
        return;
    }

    // Compute Summary KPIs
    const totalFaults = diagnoses.length;
    const maxCF = Math.round(Math.max(...diagnoses.map(d => d.certainty || 0)) * 100);
    const criticalCount = diagnoses.filter(d => (d.safety_priority || '').toUpperCase() === 'CRITICAL').length;
    const highCount = diagnoses.filter(d => (d.safety_priority || '').toUpperCase() === 'HIGH').length;

    let bannerHTML = `
        <div class="results-summary-banner">
            <div class="summary-stat-group">
                <div class="summary-stat-item">
                    <span class="summary-stat-num">${totalFaults}</span>
                    <span class="summary-stat-label">Identified Faults</span>
                </div>
                <div class="summary-stat-item">
                    <span class="summary-stat-num" style="color: var(--primary-light);">${maxCF}%</span>
                    <span class="summary-stat-label">Max Confidence (CF)</span>
                </div>
                <div class="summary-stat-item">
                    <span class="summary-stat-num" style="color: ${criticalCount > 0 ? 'var(--critical-red)' : (highCount > 0 ? 'var(--high-orange)' : 'var(--low-green)')};">
                        ${criticalCount > 0 ? 'CRITICAL HAZARD' : (highCount > 0 ? 'HIGH PRIORITY' : 'STABLE / ROUTINE')}
                    </span>
                    <span class="summary-stat-label">Severity Level</span>
                </div>
            </div>
        </div>
    `;

    let cardsHTML = '';
    diagnoses.forEach((diag, idx) => {
        const priority = (diag.safety_priority || 'MEDIUM').toUpperCase();
        const cfPct = Math.round((diag.certainty || 0) * 100);
        const reasoningId = `reasoning-trace-${idx}`;

        const rulesChips = (diag.matched_rules || [])
            .map(r => `<span class="rule-chip">${escapeHtml(r)}</span>`)
            .join('');

        const symptomsList = (diag.matched_symptoms || [])
            .map(s => escapeHtml(s))
            .join(' · ');

        const reasoningNodes = (diag.reasoning_chain || [])
            .map(step => `<div class="timeline-node">${escapeHtml(step)}</div>`)
            .join('');

        cardsHTML += `
            <article class="diagnosis-card priority-${priority}">
                <div class="diag-header">
                    <div class="diag-title-wrap">
                        <div class="diag-rank-index">RANK ${String(idx + 1).padStart(2, '0')} // ROOT CAUSE</div>
                        <h3 class="diag-cause-name">${escapeHtml(diag.cause || diag.fault || 'Anomalous Operating State')}</h3>
                    </div>
                    <div class="diag-badges">
                        <span class="cf-meter-badge">CF: ${cfPct}%</span>
                        <span class="status-badge ${priority}">${priority}</span>
                        ${diag.sensor_supported ? '<span class="sensor-boost-badge"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> Sensor Corroborated</span>' : ''}
                        ${diag.ml_prediction && diag.ml_prediction.failure_risk ? `<span class="hybrid-ai-badge" title="Validated by XGBoost ML Model"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg> Hybrid AI (ML: ${diag.ml_prediction.confidence_pct}%)</span>` : ''}
                    </div>
                </div>

                <!-- Remedial Action -->
                <div class="remedy-box">
                    <svg class="remedy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
                    </svg>
                    <div class="remedy-body">
                        <div class="remedy-label">Prescribed Maintenance Procedure</div>
                        <div class="remedy-text">${escapeHtml(diag.remedy || 'Inspect assembly according to equipment maintenance manual.')}</div>
                    </div>
                </div>

                <!-- Metadata Row -->
                <div class="diag-meta-grid">
                    <div class="diag-meta-item">
                        <span class="diag-meta-title">Affected Component</span>
                        <span class="diag-meta-val">${escapeHtml(diag.component || 'General Subsystem')}</span>
                    </div>
                    <div class="diag-meta-item">
                        <span class="diag-meta-title">Production Rules Fired</span>
                        <div class="diag-meta-val">${rulesChips || '<em>Telemetry Rule</em>'}</div>
                    </div>
                    <div class="diag-meta-item">
                        <span class="diag-meta-title">Supporting Evidence</span>
                        <span class="diag-meta-val">${symptomsList || '<em>Telemetry Deviation Only</em>'}</span>
                    </div>
                </div>

                <!-- White-Box Reasoning Chain Expander -->
                ${diag.reasoning_chain && diag.reasoning_chain.length > 0 ? `
                    <div class="reasoning-expander">
                        <button type="button" class="reasoning-trigger" onclick="toggleReasoningTrace('${reasoningId}', this)">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                            View Auditable Reasoning Trace (${diag.reasoning_chain.length} deduction steps)
                        </button>
                        <div class="reasoning-timeline" id="${reasoningId}">
                            ${reasoningNodes}
                        </div>
                    </div>
                ` : ''}
            </article>
        `;
    });

    container.innerHTML = bannerHTML + cardsHTML;
}

function toggleReasoningTrace(traceId, btnElement) {
    const timeline = document.getElementById(traceId);
    if (!timeline) return;

    const isOpen = timeline.classList.toggle('open');
    const count = timeline.children.length;

    btnElement.innerHTML = isOpen
        ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg> Hide Reasoning Trace`
        : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg> View Auditable Reasoning Trace (${count} deduction steps)`;
}

// ============================================================================
// STEPPER & NAVIGATION
// ============================================================================
function setStepActive(stepNum) {
    for (let i = 1; i <= 4; i++) {
        const pill = document.getElementById(`pillStep${i}`);
        if (!pill) continue;

        pill.classList.remove('active', 'completed');
        if (i < stepNum) {
            pill.classList.add('completed');
        } else if (i === stepNum) {
            pill.classList.add('active');
        }
    }
}

function goBack() {
    selectedMachine = null;
    selectedSymptoms.clear();

    document.querySelectorAll('.equipment-card').forEach(c => c.classList.remove('selected'));
    document.getElementById('stepSymptoms').classList.add('hidden');
    document.getElementById('stepSensors').classList.add('hidden');
    document.getElementById('actionBar').classList.add('hidden');
    document.getElementById('stepResults').classList.add('hidden');

    applyTelemetryPreset('clear');
    setStepActive(1);

    document.getElementById('stepMachine').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetAll() {
    goBack();
}

// ============================================================================
// STEP 5: MODEL BENCHMARK & EVALUATION MODAL (CT-361 REQUIREMENT)
// ============================================================================
async function openBenchmarkModal() {
    const modal = document.getElementById('benchmarkModal');
    const body = document.getElementById('benchmarkModalBody');
    if (!modal || !body) return;

    modal.classList.remove('hidden');

    try {
        const res = await fetch(`${API_BASE}/api/ml/benchmark`);
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const data = await res.json();

        let tableRows = (data.metrics || []).map(m => `
            <tr>
                <td><strong>${escapeHtml(m.metric)}</strong></td>
                <td><span class="score-baseline">${escapeHtml(m.baseline)}</span></td>
                <td><span class="score-improved">${escapeHtml(m.improved)}</span></td>
                <td><span class="score-gain">${escapeHtml(m.improvement)}</span></td>
            </tr>
        `).join('');

        body.innerHTML = `
            <div class="benchmark-summary-box">
                <div class="bench-title">${escapeHtml(data.title)}</div>
                <div class="bench-sub">
                    <span>Course: <strong>${escapeHtml(data.course || 'CT-361 AI & Expert System')}</strong></span> &bull; 
                    <span>Dataset: <strong>${escapeHtml(data.dataset)}</strong></span> &bull; 
                    <span>Architecture: <strong>Baseline (Decision Tree) vs. Improved (XGBoost)</strong></span>
                </div>
            </div>

            <!-- Metrics Comparison Table -->
            <div class="benchmark-table-wrap">
                <table class="benchmark-table">
                    <thead>
                        <tr>
                            <th>Performance Metric</th>
                            <th>Baseline (Decision Tree)</th>
                            <th>Improved (XGBoost Classifier)</th>
                            <th>Net Performance Gain</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>

            <!-- Visual Evaluation Charts -->
            <div class="charts-gallery-grid">
                <div class="chart-box">
                    <div class="chart-header">
                        <h4>1. Model Performance Comparison</h4>
                        <span class="chart-tag">Accuracy &amp; F1-Score Gain</span>
                    </div>
                    <img src="${data.charts.comparison}" alt="Model Comparison Bar Chart" class="chart-img" />
                </div>
                <div class="chart-box">
                    <div class="chart-header">
                        <h4>2. Confusion Matrix Comparison</h4>
                        <span class="chart-tag">False Negative Reduction</span>
                    </div>
                    <img src="${data.charts.confusion_matrix}" alt="Confusion Matrices" class="chart-img" />
                </div>
                <div class="chart-box full-width">
                    <div class="chart-header">
                        <h4>3. Sensor Feature Importance</h4>
                        <span class="chart-tag">Predictive Telemetry Weights</span>
                    </div>
                    <img src="${data.charts.feature_importance}" alt="Feature Importance Plot" class="chart-img" />
                </div>
            </div>
        `;
    } catch (err) {
        body.innerHTML = `<div class="error-box">Failed to load benchmark telemetry data: ${escapeHtml(err.message)}</div>`;
    }
}

function closeBenchmarkModal() {
    const modal = document.getElementById('benchmarkModal');
    if (modal) modal.classList.add('hidden');
}

// ============================================================================
// UTILITIES
// ============================================================================
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
