import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const PERMISSIONS = [
    ["manage_students", "Manage students"],
    ["manage_teachers", "Manage teachers"],
    ["manage_classes", "Manage classes"],
    ["manage_subjects", "Manage subjects"],
    ["manage_results", "Manage results"],
    ["manage_fees", "Manage fees"],
    ["manage_timetable", "Manage timetable"],
    ["manage_announcements", "Manage announcements"],
    ["manage_materials", "Manage learning materials"],
    ["manage_account_status", "Suspend or deactivate accounts"]
];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
const initials = (value) => String(value ?? "").trim().split(/\s+/).filter(Boolean)
    .slice(0, 2).map((part) => Array.from(part)[0].toLocaleUpperCase()).join("") || "U";
const avatar = (value, className) => `<span class="${className}" aria-hidden="true">${esc(initials(value))}</span>`;

export async function startSecurePortal() {
    const config = window.UMAR_SUPABASE_CONFIG;
    if (!config?.url || !config?.anonKey) throw new Error("Supabase configuration is missing.");
    const client = createClient(config.url, config.anonKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
        window.location.replace("index.html");
        return;
    }

    const { data: profileRows, error: profileError } = await client.rpc("current_account_profile");
    const profile = profileRows?.[0];
    if (profileError || !profile) {
        await client.auth.signOut();
        window.location.replace("index.html");
        return;
    }
    if (profile.status === "pending") {
        window.location.replace("index.html");
        return;
    }
    if (profile.status !== "active") {
        await client.auth.signOut();
        window.location.replace("index.html");
        return;
    }

    const root = document.getElementById("portal-content");
    const nav = document.getElementById("sidebar-nav");
    const toast = document.getElementById("toast");
    const adminRole = profile.role === "admin" || profile.role === "super_admin";
    const superAdmin = profile.role === "super_admin";
    const permitted = (name) => superAdmin || (profile.role === "admin" && profile.permissions?.[name] === true);
    const canManageStudents = permitted("manage_students");
    const canManageTeachers = permitted("manage_teachers");
    const canReadClasses = profile.role === "student" || profile.role === "teacher"
        || ["manage_classes", "manage_students", "manage_teachers", "manage_results", "manage_fees", "manage_timetable", "manage_materials"].some(permitted);
    const canReadSubjects = profile.role === "student" || profile.role === "teacher"
        || ["manage_subjects", "manage_teachers", "manage_results", "manage_timetable", "manage_materials"].some(permitted);
    let activeView = profile.role === "student" ? "home" : "dashboard";
    let toastTimer;
    let dashboardStats = {};
    let roster = [];
    let teachers = [];
    let scheduleTeachers = [];
    let classes = [];
    let subjects = [];
    let fees = [];
    let resultRows = [];
    let resultDirectory = [];
    let feeDirectory = [];
    let activities = [];

    const routes = {
        super_admin: [
            ["dashboard", "⌂", "Dashboard"], ["students", "♙", "Students"], ["teachers", "♟", "Teachers"],
            ["classes", "▦", "Classes"], ["subjects", "▤", "Subjects"], ["results", "▤", "Results"],
            ["fees", "$", "Fees"], ["timetable", "▦", "Timetable"], ["announcements", "▣", "Announcements"],
            ["materials", "⇩", "Learning materials"], ["accounts", "⚙", "Accounts"]
        ],
        admin: [
            ["dashboard", "⌂", "Dashboard"],
            ...(canManageStudents ? [["students", "♙", "Students"]] : []),
            ...(canManageTeachers ? [["teachers", "♟", "Teachers"]] : []),
            ...(permitted("manage_classes") ? [["classes", "▦", "Classes"]] : []),
            ...(permitted("manage_subjects") ? [["subjects", "▤", "Subjects"]] : []),
            ...(permitted("manage_results") ? [["results", "▤", "Results"]] : []),
            ...(permitted("manage_fees") ? [["fees", "$", "Fees"]] : []),
            ...(permitted("manage_timetable") ? [["timetable", "▦", "Timetable"]] : []),
            ...(permitted("manage_announcements") ? [["announcements", "▣", "Announcements"]] : []),
            ...(permitted("manage_materials") ? [["materials", "⇩", "Learning materials"]] : []),
            ...(canManageStudents || canManageTeachers ? [["accounts", "⚙", "Accounts"]] : [])
        ],
        student: [
            ["home", "⌂", "Home"], ["profile", "♙", "My Profile"], ["my-results", "▤", "My Results"],
            ["my-fees", "$", "Fees"], ["my-timetable", "▦", "Timetable"], ["my-announcements", "▣", "Announcements"],
            ["my-materials", "⇩", "Learning materials"], ["calculator", "＋", "Calculator"], ["password", "⚿", "Password"]
        ],
        teacher: [
            ["dashboard", "⌂", "Dashboard"], ["profile", "♙", "My Profile"], ["results", "▤", "Results"], ["timetable", "▦", "Timetable"],
            ["materials", "⇩", "Learning materials"], ["password", "⚿", "Password"]
        ]
    };

    const accountRoutes = routes[profile.role] || [];

    function showToast(message, error = false) {
        toast.textContent = message;
        toast.classList.toggle("error", error);
        toast.classList.add("visible");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove("visible"), 4500);
    }

    function showCredentials(result) {
        document.getElementById("credential-username").textContent = result.username;
        document.getElementById("credential-password").textContent = result.temporary_password;
        document.getElementById("credential-expiry").textContent = new Date(result.expires_at).toLocaleString();
        const dialog = document.getElementById("credential-dialog");
        if (typeof dialog.showModal === "function") dialog.showModal();
        else showToast(`Username: ${result.username} · Temporary password: ${result.temporary_password} · Expires ${new Date(result.expires_at).toLocaleString()}`);
    }

    function fail(error, fallback) {
        console.error(fallback, error);
        showToast(error?.message || fallback, true);
    }

    async function query(table, selection = "*", configure = (request) => request) {
        try {
            let request = client.from(table).select(selection);
            request = configure(request);

            const result = await request;
            if (!result) {
                throw new Error(`Supabase returned no response for table "${table}".`);
            }

            const { data, error } = result;
            if (error) throw error;
            return data ?? [];
        } catch (error) {
            console.error("Supabase query failed for table:", table, error);
            throw error;
        }
    }

    async function rpcRows(functionName, args = {}) {
        const { data, error } = await client.rpc(functionName, args);
        if (error) throw error;
        return data || [];
    }

    async function rpcOne(functionName, args = {}) {
        const rows = await rpcRows(functionName, args);
        return rows[0] || null;
    }

    async function write(table, method, values, id, onConflict) {
        let request = client.from(table)[method](values, onConflict ? { onConflict } : undefined);
        if (id) request = request.eq("id", id);
        const { data, error } = await request.select().maybeSingle();
        if (error) throw error;
        return data;
    }

    async function invoke(name, body) {
        const { data, error } = await client.functions.invoke(name, { body });
        if (error) {
            let detail = error.message;
            try {
                const response = await error.context?.json();
                if (response?.error) detail = response.error;
            } catch {
                // Supabase may return an empty response for network and CORS errors.
            }
            throw new Error(detail);
        }
        if (data?.error) throw new Error(data.error);
        return data;
    }

    function navRender() {
        nav.innerHTML = accountRoutes.map(([view, icon, label]) => `
            <button class="nav-link${activeView === view ? " active" : ""}" type="button" data-view="${view}" ${activeView === view ? 'aria-current="page"' : ""}>
                <span class="nav-icon" aria-hidden="true">${icon}</span><span>${label}</span>
            </button>`).join("");
        document.getElementById("sidebar-name").textContent = profile.display_name;
        document.getElementById("sidebar-role").textContent = profile.role.replaceAll("_", " ");
        document.getElementById("sidebar-avatar").textContent = initials(profile.display_name);
    }

    function heading(kicker, title, description = "") {
        return `<header class="page-heading"><p>${esc(kicker)}</p><h1>${esc(title)}</h1>${description ? `<p class="heading-description">${esc(description)}</p>` : ""}</header>`;
    }

    function stat(label, value, icon) {
        return `<article class="stat-card"><span class="stat-icon">${icon}</span><span class="stat-label">${esc(label)}</span><strong>${esc(value)}</strong></article>`;
    }

    function panel(title, content, kicker = "") {
        return `<section class="panel"><div class="panel-heading"><div>${kicker ? `<p class="card-eyebrow">${esc(kicker)}</p>` : ""}<h2>${esc(title)}</h2></div></div>${content}</section>`;
    }

    function empty(text) {
        return `<p class="empty-state">${esc(text)}</p>`;
    }

    function makeTable(headers, rows) {
        return `<div class="table-wrap"><table><thead><tr>${headers.map((value) => `<th>${esc(value)}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}">${empty("No records to display.")}</td></tr>`}</tbody></table></div>`;
    }

    function formField(label, name, type = "text", required = true, value = "", extra = "") {
        return `<label class="form-field"><span>${esc(label)}</span><input name="${esc(name)}" type="${type}" value="${esc(value)}" ${required ? "required" : ""} ${extra}></label>`;
    }

    function selectField(label, name, options, required = true) {
        return `<label class="form-field"><span>${esc(label)}</span><select name="${esc(name)}" ${required ? "required" : ""}>${options}</select></label>`;
    }

    function textOptions(rows, label, value, selected = "") {
        return `<option value="">Select ${esc(label.toLowerCase())}</option>${rows.map((row) => `<option value="${esc(row[value])}" ${row[value] === selected ? "selected" : ""}>${esc(row[label])}</option>`).join("")}`;
    }

    function dataSelects() {
        const optional = async (table, selection, configure, isAllowed) => {
            try {
                return await query(table, selection, configure);
            } catch (error) {
                if (!isAllowed || error.code === "42501" || error.code === "PGRST301") return [];
                throw error;
            }
        };
        return Promise.all([
            canReadClasses ? query("classes", "id, name, department, academic_year") : Promise.resolve([]),
            canReadSubjects ? query("subjects", "id, name, code") : Promise.resolve([]),
            optional("fee_items", "id, name, amount, academic_year, class_id, due_date, active", undefined, !permitted("manage_fees")),
            canManageStudents
                ? query("student_management_directory", "id, user_id, admission_number, class_id, phone, username, display_name, status")
                : Promise.resolve([]),
            canManageTeachers
                ? query("teacher_management_directory", "id, user_id, employee_number, phone, username, display_name, status")
                : Promise.resolve([])
        ]).then(([classRows, subjectRows, feeRows, studentRows, teacherRows]) => {
            classes = classRows;
            subjects = subjectRows;
            fees = feeRows;
            roster = studentRows.map((row) => ({
                ...row,
                person: { username: row.username, display_name: row.display_name, status: row.status },
                class: classRows.find((c) => c.id === row.class_id)
            }));
            teachers = teacherRows.map((row) => ({
                ...row,
                person: { username: row.username, display_name: row.display_name, status: row.status }
            }));
        });
    }

    async function loadStats() {
        const count = async (tableName, modify, hidden) => {
            if (hidden) return null;
            let request = client.from(tableName).select("id", { count: "exact", head: true });
            if (modify) request = modify(request);
            try {
                const { count: total, error } = await request;
                if (error) throw error;
                return total ?? 0;
            } catch (error) {
                if (error.code === "42501" || error.code === "PGRST301") return null;
                throw error;
            }
        };
        const [studentCount, teacherCount, classCount, subjectCount, activeCount, pendingCount, suspendedCount, activityRows] = await Promise.all([
            count("student_management_directory", null, !canManageStudents && !superAdmin),
            count("teacher_management_directory", null, !canManageTeachers && !superAdmin),
            count("classes", null, !canReadClasses),
            count("subjects", null, !canReadSubjects),
            count("account_management_directory", (request) => request.eq("status", "active"), !superAdmin),
            count("account_management_directory", (request) => request.eq("status", "pending"), !superAdmin),
            count("account_management_directory", (request) => request.eq("status", "suspended"), !superAdmin),
            query("account_activities", "id, action, entity_type, created_at", (request) => request.order("created_at", { ascending: false }).limit(8)).catch((error) => {
                if (error.code === "42501" || error.code === "PGRST301") return [];
                throw error;
            })
        ]);
        dashboardStats = {
            "Total students": studentCount ?? "Restricted",
            "Total teachers": teacherCount ?? "Restricted",
            "Total classes": classCount ?? "Restricted",
            "Total subjects": subjectCount ?? "Restricted",
            "Active accounts": activeCount ?? "Restricted",
            "Pending accounts": pendingCount ?? "Restricted",
            "Suspended accounts": suspendedCount ?? "Restricted"
        };
        activities = activityRows;
    }

    async function refreshData() {
        await Promise.all([dataSelects(), loadStats()]);
    }

    async function renderDashboard() {
        const cards = Object.entries(dashboardStats).map(([label, amount], index) =>
            stat(label, amount, ["♙", "♟", "▦", "▤", "●", "◷", "!"][index])).join("");
        const activityRows = activities.map((item) => `<div class="activity-row"><span class="activity-dot"></span><span>${esc(item.action)} ${esc(item.entity_type)}</span><time>${esc(new Date(item.created_at).toLocaleDateString())}</time></div>`).join("");
        const quick = accountRoutes.filter(([, , label]) => label !== "Dashboard" && label !== "Accounts")
            .slice(0, 5).map(([view, , label]) => `<button class="quick-action" type="button" data-view="${view}">${esc(label)} <span>→</span></button>`).join("");
        const staffHero = profile.role === "teacher"
            ? `<section class="student-hero">${avatar(profile.display_name, "hero-avatar")}<div><p class="card-eyebrow">STAFF PROFILE</p><h2>${esc(profile.display_name)}</h2><p>Teacher · ${esc(profile.username)}</p></div><button class="small-button light-button" type="button" data-view="profile">View profile</button></section>`
            : "";
        return `${heading(profile.role.replaceAll("_", " ").toUpperCase(), `Welcome, ${profile.display_name}`, "School operations at a glance.")}
            ${staffHero}
            <section class="stat-grid">${cards}</section>
            <div class="dashboard-grid">${panel("Recent activities", activityRows || empty("No recent activity."), "AUDIT TRAIL")}
                ${adminRole ? panel("Account", `<p class="heading-description">Signed in as ${esc(profile.username)}. Your access is controlled by your assigned role and permissions.</p>`, "SECURE SESSION") : ""}</div>
            <section class="quick-actions">${quick}</section>`;
    }

    async function renderStudentHome() {
        const student = await rpcOne("current_student_record");
        const ownResults = student ? await query("results", "id, term, academic_year, continuous_assessment, examination_score, total, grade, published, subject:subjects(name)", (request) => request.eq("student_id", student.id).eq("published", true).order("created_at", { ascending: false }).limit(5)) : [];
        const ownFees = student ? await query("payment_records", "amount_paid, verified, payment_date, fee:fee_items(name, amount)", (request) => request.eq("student_id", student.id).order("payment_date", { ascending: false }).limit(5)) : [];
        const notices = await query("announcements", "id, title, body, publish_at", (request) => request.eq("published", true).lte("publish_at", new Date().toISOString()).order("publish_at", { ascending: false }).limit(3));
        const classRow = student?.class_id ? classes.find((item) => item.id === student.class_id) : null;
        const average = ownResults.length ? Math.round(ownResults.reduce((sum, item) => sum + Number(item.total), 0) / ownResults.length) : 0;
        const results = ownResults.map((item) => `<tr><td>${esc(item.subject?.name)}</td><td>${esc(item.term)}</td><td>${esc(item.total)}%</td><td>${esc(item.grade)}</td></tr>`).join("");
        const noticesMarkup = notices.map((item) => `<article class="notice-preview"><time>${esc(new Date(item.publish_at).toLocaleDateString())}</time><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p></article>`).join("") || empty("No announcements are published.");
        const verifiedPayments = ownFees.filter((item) => item.verified).reduce((sum, item) => sum + Number(item.amount_paid), 0);
        const feeSummary = ownFees.length
            ? `<p class="heading-description">Verified payments to date: ${esc(verifiedPayments.toFixed(2))}. Unverified records are not treated as received payments.</p>`
            : empty("No payment records are available.");
        return `${heading("STUDENT DASHBOARD", `Welcome, ${profile.display_name}`, "Your learning, school notices and personal information.")}
            <section class="student-hero">${avatar(profile.display_name, "hero-avatar")}<div><p class="card-eyebrow">STUDENT PROFILE</p><h2>${esc(profile.display_name)}</h2><p>${esc(student?.admission_number || "Admission number pending")} · ${esc(classRow?.name || "Class not assigned")} ${classRow?.department ? `· ${esc(classRow.department)}` : ""}</p></div><button class="small-button light-button" type="button" data-view="profile">View profile</button></section>
            <section class="stat-grid student-stats">${stat("Published subjects", ownResults.length, "▤")}${stat("Average score", `${average}%`, "↗")}${stat("Verified payments", verifiedPayments.toFixed(2), "$")}</section>
            <div class="dashboard-grid">${panel("Recent examination results", makeTable(["Subject", "Term", "Total", "Grade"], results), "ACADEMIC RECORDS")}
                ${panel("School announcements", noticesMarkup, "SCHOOL NEWS")}</div>
            ${panel("School fee status", feeSummary, "PAYMENT RECORDS")}
            <section class="quick-actions"><button class="quick-action" type="button" data-view="calculator">Open calculator <span>→</span></button><button class="quick-action" type="button" data-view="my-timetable">Class timetable <span>→</span></button><button class="quick-action" type="button" data-view="my-materials">Learning materials <span>→</span></button></section>`;
    }

    async function renderStudents() {
        const rows = roster.map((row) => `<tr data-student-class="${esc(row.class?.name || "Unassigned")}" data-student-status="${esc(row.person?.status || "")}"><td><div class="person-cell">${avatar(row.person?.display_name || "Student", "person-avatar")}<span>${esc(row.person?.display_name || "—")}<small class="table-subtext">@${esc(row.person?.username || "")}</small></span></div></td>
            <td>${esc(row.admission_number)}</td><td>${esc(row.class?.name || "Unassigned")}</td><td>${esc(row.person?.status || "—")}</td><td>${esc(row.phone || "—")}</td>
            <td class="action-cell"><button class="row-action" type="button" data-edit-profile="${esc(row.user_id)}" data-kind="student">Edit</button><button class="row-action" type="button" data-reset-password="${esc(row.user_id)}" data-kind="student">Reset password</button>${permitted("manage_account_status") && !(superAdmin && row.person?.status === "pending") && !(profile.role === "admin" && row.person?.status === "inactive") ? `<button class="row-action danger-text" type="button" data-status-user="${esc(row.user_id)}" data-status="${row.person?.status === "active" ? "suspended" : (superAdmin ? "active" : "inactive")}">${row.person?.status === "active" ? "Suspend" : (superAdmin ? "Activate" : "Deactivate")}</button>` : (superAdmin && row.person?.status === "pending" ? "Pending activation" : "")}</td></tr>`).join("");
        return `${heading("STUDENT RECORDS", "Student management", "Register student accounts and maintain their admission details.")}
            <div class="management-layout"><section class="panel form-panel"><div class="panel-heading"><div><p class="card-eyebrow">NEW STUDENT</p><h2>Register student</h2></div></div>
                <form id="create-account-form" class="portal-form" data-role="student">
                    ${formField("Full name", "display_name")}${formField("Username hint (optional)", "username_hint", "text", false)}
                    ${selectField("Class", "class_id", `<option value="">Not assigned</option>${classes.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}`, false)}
                    ${formField("Date of birth", "date_of_birth", "date", false)}${formField("Phone", "phone", "tel", false)}
                    <div class="form-actions"><button class="primary-button" type="submit">Create student account</button></div>
                </form></section>
                <section class="panel"><div class="panel-heading"><div><p class="card-eyebrow">ENROLMENT</p><h2>Student directory <span class="count-pill">${roster.length}</span></h2></div></div>
                <div class="student-filters"><label class="form-field search-field"><span>Search students</span><input type="search" data-search="students" placeholder="Name or admission number"></label>
                    <label class="form-field"><span>Class</span><select data-filter="class"><option value="">All classes</option>${classes.map((item) => `<option>${esc(item.name)}</option>`).join("")}<option>Unassigned</option></select></label>
                    <label class="form-field"><span>Account status</span><select data-filter="status"><option value="">All statuses</option>${["pending", "active", "suspended", "inactive"].map((item) => `<option>${item}</option>`).join("")}</select></label></div>
                ${makeTable(["Student", "Admission", "Class", "Status", "Phone", "Actions"], rows)}</section></div>`;
    }

    async function renderTeachers() {
        const rows = teachers.map((row) => `<tr><td><div class="person-cell">${avatar(row.person?.display_name || "Staff", "person-avatar")}<span>${esc(row.person?.display_name || "—")}<small class="table-subtext">@${esc(row.person?.username || "")}</small></span></div></td><td>${esc(row.employee_number)}</td><td>${esc(row.person?.status || "—")}</td><td>${esc(row.phone || "—")}</td><td class="action-cell"><button class="row-action" type="button" data-edit-profile="${esc(row.user_id)}" data-kind="teacher">Edit</button><button class="row-action" type="button" data-reset-password="${esc(row.user_id)}" data-kind="teacher">Reset password</button></td></tr>`).join("");
        const classOptions = classes.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
        const subjectOptions = subjects.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
        return `${heading("STAFF DIRECTORY", "Teacher management", "Create teacher accounts, assign classes and subjects, and review staff status.")}
            <div class="management-layout"><section class="panel form-panel"><div class="panel-heading"><div><p class="card-eyebrow">NEW STAFF ACCOUNT</p><h2>Register teacher</h2></div></div>
                <form id="create-account-form" class="portal-form" data-role="teacher">
                    ${formField("Full name", "display_name")}${formField("Username hint (optional)", "username_hint", "text", false)}${formField("Phone", "phone", "tel", false)}
                    <label class="form-field"><span>Assigned classes</span><select name="class_ids" multiple size="4" required>${classOptions}</select></label>
                    <label class="form-field"><span>Assigned subjects</span><select name="subject_ids" multiple size="4" required>${subjectOptions}</select></label>
                    <div class="form-actions"><button class="primary-button" type="submit">Create teacher account</button></div>
                </form></section><section class="panel"><div class="panel-heading"><div><p class="card-eyebrow">TEACHING STAFF</p><h2>Teachers</h2></div></div>${makeTable(["Teacher", "Employee number", "Status", "Phone", "Actions"], rows)}</section></div>`;
    }

    function renderClasses() {
        const rows = classes.map((item) => `<tr><td>${esc(item.name)}</td><td>${esc(item.department || "—")}</td><td>${esc(item.academic_year)}</td><td class="action-cell"><button class="row-action" data-edit-row="classes" data-id="${esc(item.id)}" type="button">Edit</button><button class="row-action danger-text" data-delete-row="classes" data-id="${esc(item.id)}" type="button">Delete</button></td></tr>`).join("");
        return `${heading("ACADEMIC SETUP", "Classes", "Create school classes and assign academic years.")}
            <section class="panel"><form class="portal-form inline-form" id="class-form">${formField("Class name", "name")}${formField("Department", "department", "text", false)}${formField("Academic year", "academic_year", "text", true, new Date().getFullYear() + "/" + (new Date().getFullYear() + 1))}<button class="primary-button" type="submit">Add class</button></form></section>
            ${panel("School classes", makeTable(["Class", "Department", "Academic year", "Actions"], rows))}`;
    }

    function renderSubjects() {
        const rows = subjects.map((item) => `<tr><td>${esc(item.name)}</td><td>${esc(item.code || "—")}</td><td class="action-cell"><button class="row-action" data-edit-row="subjects" data-id="${esc(item.id)}" type="button">Edit</button><button class="row-action danger-text" data-delete-row="subjects" data-id="${esc(item.id)}" type="button">Delete</button></td></tr>`).join("");
        return `${heading("ACADEMIC SETUP", "Subjects", "Maintain subjects used for results and timetables.")}
            <section class="panel"><form class="portal-form inline-form" id="subject-form">${formField("Subject name", "name")}${formField("Subject code", "code", "text", false)}<button class="primary-button" type="submit">Add subject</button></form></section>
            ${panel("Subject list", makeTable(["Subject", "Code", "Actions"], rows))}`;
    }

    function renderResults() {
        const rows = resultRows.map((result) => `<tr><td>${esc(result.student?.profile?.display_name)}</td><td>${esc(result.student?.admission_number)}</td><td>${esc(result.student?.class_name || result.student?.class?.name || "—")}</td><td>${esc(result.subject?.name)}</td><td>${esc(result.term)} · ${esc(result.academic_year)}</td><td>${esc(result.continuous_assessment)} / 40</td><td>${esc(result.examination_score)} / 60</td><td>${esc(result.total)}</td><td>${esc(result.grade)}</td><td>${result.published ? "Published" : "Draft"}</td><td>${adminRole ? `<button class="row-action" type="button" data-edit-result="${esc(result.id)}">Edit</button><button class="row-action" type="button" data-publish-result="${esc(result.id)}" data-published="${result.published}">${result.published ? "Unpublish" : "Publish"}</button>` : ""}</td></tr>`).join("");
        const studentOptions = resultDirectory.map((r) => `<option value="${esc(r.id)}">${esc(r.display_name)} — ${esc(r.admission_number)}</option>`).join("");
        const subjectOptions = subjects.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
        const form = adminRole ? `<section class="panel form-panel"><form id="result-form" class="portal-form inline-form">
            ${selectField("Student", "student_id", studentOptions)}${selectField("Subject", "subject_id", subjectOptions)}
            ${formField("Term", "term")}${formField("Academic year", "academic_year", "text", true, `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`)}
            ${formField("Continuous assessment (0–40)", "continuous_assessment", "number", true, "", 'min="0" max="40" step="0.01"')}
            ${formField("Examination (0–60)", "examination_score", "number", true, "", 'min="0" max="60" step="0.01"')}
            <label class="checkbox-field"><input name="published" type="checkbox"><span>Publish result</span></label>
            <button class="primary-button" type="submit">Save result</button>
            </form></section>` : "";
        return `${heading("ASSESSMENT", "Examination results", adminRole ? "Record CA and examination marks; database rules calculate totals and grades." : "Only results published to your account are shown.")}${form}
            ${panel("Results", makeTable(["Student", "Admission", "Class", "Subject", "Term", "CA", "Exam", "Total", "Grade", "Status", "Action"], rows))}`;
    }

    async function renderFees(studentMode = false) {
        const feeRows = fees.map((fee) => `<tr><td>${esc(fee.name)}</td><td>${esc(fee.academic_year)}</td><td>${esc(fee.class_id ? classes.find((c) => c.id === fee.class_id)?.name : "All classes")}</td><td>${esc(Number(fee.amount).toFixed(2))}</td><td>${esc(fee.due_date || "—")}</td>${adminRole ? `<td><button class="row-action" data-edit-row="fee_items" data-id="${esc(fee.id)}" type="button">Edit</button><button class="row-action danger-text" data-delete-row="fee_items" data-id="${esc(fee.id)}" type="button">Delete</button></td>` : ""}</tr>`).join("");
        if (studentMode) {
            const student = await rpcOne("current_student_record");
            const classId = student?.class_id;
            const applicable = fees.filter((fee) => fee.active && (!fee.class_id || fee.class_id === classId));
            const paymentRows = await awaitStudentPayments(student?.id, applicable);
            const scheduleRows = applicable.map((fee) => `<tr><td>${esc(fee.name)}</td><td>${esc(fee.academic_year)}</td><td>${esc(Number(fee.amount).toFixed(2))}</td><td>${esc(fee.due_date || "—")}</td></tr>`).join("");
            return `${heading("SCHOOL FEES", "My fees and payments", "Payment records are marked verified only after the school confirms receipt.")}
            ${panel("Current fee items", makeTable(["Fee", "Academic year", "Amount", "Due date"], scheduleRows))}
            ${paymentRows}`;
        }
        const paymentRows = await loadPayments();
        feeDirectory = await query("student_fee_directory", "id, admission_number, display_name, class_id, class_name");
        const studentOptions = feeDirectory.map((r) => `<option value="${esc(r.id)}">${esc(r.display_name)} — ${esc(r.admission_number)}</option>`).join("");
        const feeOptions = fees.map((f) => `<option value="${esc(f.id)}">${esc(f.name)} — ${esc(Number(f.amount).toFixed(2))}</option>`).join("");
        return `${heading("FINANCE", "School fees", "Track fee schedules, payments, and outstanding balances. Unverified payments are not counted as received.")}
            <section class="panel"><form id="fee-form" class="portal-form inline-form">${formField("Fee name", "name")}${formField("Amount", "amount", "number", true, "", 'min="0" step="0.01"')}${formField("Academic year", "academic_year", "text", true, `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`)}${selectField("Class (blank applies to all)", "class_id", `<option value="">All classes</option>${classes.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}`, false)}${formField("Due date", "due_date", "date", false)}<button class="primary-button" type="submit">Set fee</button></form></section>
            ${panel("Fee schedule", makeTable(["Fee", "Academic year", "Class", "Amount", "Due date", "Actions"], feeRows), "FEES")}
            <section class="panel"><form id="payment-form" class="portal-form inline-form">${selectField("Student", "student_id", studentOptions)}${selectField("Fee item", "fee_item_id", feeOptions)}${formField("Amount paid", "amount_paid", "number", true, "", 'min="0.01" step="0.01"')}${formField("Payment date", "payment_date", "date", true, new Date().toISOString().slice(0, 10))}${formField("Receipt reference (optional)", "reference", "text", false)}<label class="checkbox-field"><input name="verified" type="checkbox"><span>Verified by the school (confirm receipt first)</span></label><button class="primary-button" type="submit">Record payment</button></form></section>
            ${panel("Student payment records", makeTable(["Student", "Fee", "Amount", "Date", "Reference", "Status", "Action"], paymentRows))}`;
    }

    async function awaitStudentPayments(studentId, applicableFees) {
        const student = studentId;
        if (!student) return empty("No student fee profile is available.");
        const rows = await query("payment_records", "id, fee_item_id, amount_paid, payment_date, reference, verified, fee:fee_items(name)", (request) => request.eq("student_id", student).order("payment_date", { ascending: false }));
        const body = rows.map((row) => `<tr><td>${esc(row.fee?.name)}</td><td>${esc(Number(row.amount_paid).toFixed(2))}</td><td>${esc(row.payment_date)}</td><td>${esc(row.reference || "—")}</td><td><span class="status-pill ${row.verified ? "published" : "draft"}">${row.verified ? "Verified" : "Awaiting verification"}</span></td></tr>`).join("");
        const balances = applicableFees.map((fee) => {
            const paid = rows.filter((item) => item.fee_item_id === fee.id && item.verified).reduce((sum, item) => sum + Number(item.amount_paid), 0);
            return `<tr><td>${esc(fee.name)}</td><td>${esc(Number(fee.amount).toFixed(2))}</td><td>${esc(paid.toFixed(2))}</td><td>${esc(Math.max(0, Number(fee.amount) - paid).toFixed(2))}</td></tr>`;
        }).join("");
        return `${panel("Fee balances", makeTable(["Fee", "Amount due", "Verified payments", "Outstanding"], balances))}
            ${panel("Payment history", makeTable(["Fee", "Amount", "Date", "Reference", "Status"], body))}`;
    }

    async function loadPayments() {
        const payments = await query("fee_admin_ledger", "id, amount_paid, payment_date, reference, verified, fee_name, admission_number, student_name", (request) => request.order("payment_date", { ascending: false }));
        return payments.map((item) => `<tr><td>${esc(item.student_name)}<small class="table-subtext">${esc(item.admission_number)}</small></td><td>${esc(item.fee_name)}</td><td>${esc(Number(item.amount_paid).toFixed(2))}</td><td>${esc(item.payment_date)}</td><td>${esc(item.reference || "—")}</td><td>${item.verified ? "Verified" : "Unverified"}</td><td>${!item.verified ? `<button class="row-action" type="button" data-verify-payment="${esc(item.id)}">Verify receipt</button>` : ""}</td></tr>`).join("");
    }

    function renderTimetable(studentMode = false) {
        const entries = window.secureTimetableRows || [];
        const rows = entries.map((item) => `<tr><td>${esc(DAYS[item.day_of_week - 1])}</td><td>${esc(item.starts_at)}–${esc(item.ends_at)}</td><td>${esc(item.subject?.name)}</td><td>${esc(item.teacher?.profile?.display_name || "—")}</td><td>${esc(item.class?.name || "")}</td>${adminRole ? `<td><button class="row-action" data-edit-row="timetable_entries" data-id="${esc(item.id)}" type="button">Edit</button><button class="row-action danger-text" data-delete-row="timetable_entries" data-id="${esc(item.id)}" type="button">Delete</button></td>` : ""}</tr>`).join("");
        const classOptions = classes.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
        const subjectOptions = subjects.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
        const teacherOptions = scheduleTeachers.map((t) => `<option value="${esc(t.id)}">${esc(t.person?.display_name)}</option>`).join("");
        const form = adminRole ? `<section class="panel"><form id="timetable-form" class="portal-form inline-form">${selectField("Class", "class_id", classOptions)}${selectField("Subject", "subject_id", subjectOptions)}${selectField("Teacher", "teacher_id", `<option value="">Unassigned</option>${teacherOptions}`, false)}${selectField("Day", "day_of_week", DAYS.map((d, i) => `<option value="${i + 1}">${d}</option>`).join(""))}${formField("Starts", "starts_at", "time")}${formField("Ends", "ends_at", "time")}${formField("Room", "room", "text", false)}<label class="checkbox-field"><input name="published" type="checkbox"><span>Publish</span></label><button class="primary-button" type="submit">Add lesson</button></form></section>` : "";
        return `${heading("SCHOOL SCHEDULE", studentMode ? "My class timetable" : "Timetable", studentMode ? "Lessons for your assigned class." : "Manage or view class lesson schedules.")}${form}
            ${panel("Weekly timetable", makeTable(["Day", "Time", "Subject", "Teacher", "Class", ...(adminRole ? ["Actions"] : [])], rows))}`;
    }

    function renderAnnouncements(studentMode = false) {
        const rows = window.secureAnnouncements || [];
        const form = adminRole ? `<section class="panel"><form id="announcement-form" class="portal-form">${formField("Announcement title", "title")}${`<label class="form-field"><span>Message</span><textarea name="body" required rows="4" maxlength="5000"></textarea></label>`}${formField("Publish date and time", "publish_at", "datetime-local", true, new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16))}<label class="checkbox-field"><input name="published" type="checkbox"><span>Publish now</span></label><button class="primary-button" type="submit">Save announcement</button></form></section>` : "";
        const cards = rows.map((item) => `<article class="notice-card"><div class="notice-card-top"><time>${esc(new Date(item.publish_at).toLocaleString())}</time>${adminRole ? `<button class="row-action" data-edit-row="announcements" data-id="${esc(item.id)}" type="button">Edit</button><button class="row-action danger-text" data-delete-row="announcements" data-id="${esc(item.id)}" type="button">Delete</button>` : ""}</div><h2>${esc(item.title)}</h2><p>${esc(item.body)}</p></article>`).join("") || empty("No published announcements.");
        return `${heading("SCHOOL COMMUNICATION", "Announcements", "Official notices and updates from Umar International High School.")}${form}<section class="notice-list">${cards}</section>`;
    }

    function renderMaterials() {
        const items = window.secureMaterials || [];
        const rows = items.map((item) => `<tr><td>${esc(item.title)}</td><td>${esc(item.file_name)}</td><td>${esc(item.class?.name || "All classes")}</td><td>${item.published ? "Published" : "Draft"}</td><td><button class="row-action" data-download-material="${esc(item.id)}" type="button">Download</button>${adminRole ? `<button class="row-action" data-edit-row="learning_materials" data-id="${esc(item.id)}" type="button">Edit</button><button class="row-action danger-text" data-delete-row="learning_materials" data-id="${esc(item.id)}" type="button">Delete</button>` : ""}</td></tr>`).join("");
        const form = adminRole ? `<section class="panel"><form id="material-form" class="portal-form inline-form">${formField("Title", "title")}${formField("Description", "description", "text", false)}${selectField("Class (blank for all students)", "class_id", `<option value="">All classes</option>${classes.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}`, false)}${selectField("Subject", "subject_id", `<option value="">No subject</option>${subjects.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}`, false)}<label class="form-field"><span>Document (PDF, image or DOCX; max 20 MB)</span><input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.docx" required></label><label class="checkbox-field"><input name="published" type="checkbox"><span>Publish to students</span></label><button class="primary-button" type="submit">Upload material</button></form></section>` : "";
        return `${heading("LEARNING RESOURCES", "Learning materials", "Download resources shared with your class.")}${form}${panel("Available materials", makeTable(["Title", "File", "Class", "Status", "Actions"], rows))}`;
    }

    async function renderProfile() {
        const isStudent = profile.role === "student";
        const row = isStudent
            ? await rpcOne("current_student_record")
            : (await query("teachers", "employee_number, phone", (request) => request.eq("user_id", profile.id)))[0];
        const values = isStudent
            ? [["Name", profile.display_name], ["Username", profile.username], ["Role", profile.role], ["Account status", profile.status], ["Admission number", row?.admission_number], ["Class", row?.class_name], ["Department", row?.department], ["Date of birth", row?.date_of_birth], ["Phone", row?.phone]]
            : [["Name", profile.display_name], ["Username", profile.username], ["Role", profile.role], ["Account status", profile.status], ["Employee number", row?.employee_number], ["Phone", row?.phone]];
        const fields = values.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value || "Not recorded")}</dd></div>`).join("");
        return `${heading(isStudent ? "STUDENT INFORMATION" : "STAFF INFORMATION", "My profile", "Personal details held by the school.")}${panel(isStudent ? "Student details" : "Staff details", `<div class="profile-card">${avatar(profile.display_name, "profile-large")}<dl class="profile-details-grid">${fields}</dl></div>`)}`;
    }

    async function renderStudentResults() {
        const student = await rpcOne("current_student_record");
        const rows = student ? await query("results", "term, academic_year, continuous_assessment, examination_score, total, grade, subject:subjects(name)", (request) => request.eq("student_id", student.id).eq("published", true).order("academic_year", { ascending: false })) : [];
        const body = rows.map((item) => `<tr><td>${esc(item.term)}</td><td>${esc(item.academic_year)}</td><td>${esc(item.subject?.name)}</td><td>${esc(item.continuous_assessment)} / 40</td><td>${esc(item.examination_score)} / 60</td><td>${esc(item.total)}</td><td>${esc(item.grade)}</td></tr>`).join("");
        return `${heading("ACADEMIC RECORDS", "My results", "Only published results assigned to your account are shown.")}${panel("Published results", makeTable(["Term", "Year", "Subject", "CA", "Exam", "Total", "Grade"], body))}`;
    }

    async function renderCalculator() {
        const markup = `<section class="calculator-container"><section class="calculator"><p class="welcome-message">Basic arithmetic</p><output id="secure-display" aria-live="polite">0</output><div class="buttons">
            <button class="clear" data-calc="clear" type="button">AC</button><button class="operator" data-calc="delete" type="button">DEL</button><button class="operator" data-calc="percent" type="button">%</button><button class="operator" data-op="/" type="button">÷</button>
            ${["7","8","9"].map((n) => `<button data-num="${n}" type="button">${n}</button>`).join("")}<button class="operator" data-op="*" type="button">×</button>
            ${["4","5","6"].map((n) => `<button data-num="${n}" type="button">${n}</button>`).join("")}<button class="operator" data-op="-" type="button">−</button>
            ${["1","2","3"].map((n) => `<button data-num="${n}" type="button">${n}</button>`).join("")}<button class="operator" data-op="+" type="button">+</button>
            <button class="zero" data-num="0" type="button">0</button><button data-calc="decimal" type="button">.</button><button class="equal" data-calc="equals" type="button">=</button>
            </div></section></section>`;
        return `${heading("LEARNING TOOLS", "Calculator", "A calculator for your schoolwork.")}${markup}`;
    }

    function renderPassword() {
        return `${heading("ACCOUNT SECURITY", "Change password", "Use a unique password of at least 12 characters.")}${panel("Set a new password", `<form id="password-form" class="portal-form">${formField("New password", "password", "password", true, "", 'minlength="12" autocomplete="new-password"')}${formField("Confirm password", "confirmation", "password", true, "", 'minlength="12" autocomplete="new-password"')}<button class="primary-button" type="submit">Change password</button></form>`)}`;
    }

    async function renderAccounts() {
        const people = await query("account_management_directory", "id, username, display_name, role, status, permissions, created_at", (request) => request.order("created_at", { ascending: false }));
        const rows = people.map((person) => `<tr><td>${esc(person.display_name)}</td><td>${esc(person.username)}</td><td>${esc(person.role.replaceAll("_", " "))}</td><td>${esc(person.status)}</td><td>${esc(new Date(person.created_at).toLocaleDateString())}</td>
            <td class="action-cell">${person.role !== "super_admin" && person.id !== profile.id ? `${superAdmin && person.role === "admin" ? `<button class="row-action" data-edit-profile="${esc(person.id)}" data-kind="admin" type="button">Edit</button>` : ""}
                ${((person.role === "student" && canManageStudents) || (person.role === "teacher" && canManageTeachers) || superAdmin) ? `<button class="row-action" data-reset-password="${esc(person.id)}" data-kind="${esc(person.role)}" type="button">Reset password</button>` : ""}
                ${superAdmin && person.role === "admin" ? `<button class="row-action" data-edit-permissions="${esc(person.id)}" type="button">Permissions</button>` : ""}
                ${permitted("manage_account_status") && !(superAdmin && person.status === "pending") && !(profile.role === "admin" && person.status === "inactive") ? `<button class="row-action danger-text" data-status-user="${esc(person.id)}" data-status="${superAdmin ? (person.status === "active" ? "suspended" : "active") : (person.status === "active" ? "suspended" : "inactive")}" type="button">${superAdmin ? (person.status === "active" ? "Suspend" : "Activate") : (person.status === "active" ? "Suspend" : "Deactivate")}</button>` : (superAdmin && person.status === "pending" ? "Pending activation" : "")}
                ${superAdmin ? `<button class="row-action danger-text" data-delete-account="${esc(person.id)}" type="button">Delete</button>` : ""}` : ""}</td></tr>`).join("");
        const createAdminForm = superAdmin ? `<section class="panel"><form id="create-account-form" class="portal-form" data-role="admin">${formField("Administrator name", "display_name")}${formField("Username hint (optional)", "username_hint", "text", false)}<p class="score-note">New administrator accounts start pending. Permission grants can be adjusted by a Super Admin.</p><button class="primary-button" type="submit">Create administrator</button></form></section>` : "";
        return `${heading("ACCOUNT CONTROL", "Accounts", "Manage account statuses and credentials. Temporary passwords are shown once after a successful reset.")}${createAdminForm}
            ${panel("School accounts", makeTable(["Name", "Username", "Role", "Status", "Created", "Actions"], rows))}`;
    }

    async function renderView() {
        await refreshData();
        const pages = {
            dashboard: renderDashboard,
            students: renderStudents,
            teachers: renderTeachers,
            classes: renderClasses,
            subjects: renderSubjects,
            results: renderResults,
            fees: () => renderFees(false),
            "my-fees": () => renderFees(true),
            timetable: () => renderTimetable(false),
            "my-timetable": () => renderTimetable(true),
            announcements: () => renderAnnouncements(false),
            "my-announcements": () => renderAnnouncements(true),
            materials: renderMaterials,
            "my-materials": renderMaterials,
            profile: renderProfile,
            "my-results": renderStudentResults,
            calculator: renderCalculator,
            password: renderPassword,
            accounts: renderAccounts,
            home: renderStudentHome
        };
        const route = accountRoutes.find(([view]) => view === activeView);
        if (!route || !pages[activeView]) {
            activeView = accountRoutes[0]?.[0] || "dashboard";
            navRender();
            await renderView();
            return;
        }

        if (["timetable", "my-timetable"].includes(activeView)) {
            let teacherClasses = [];
            if (profile.role === "teacher") {
                const ownTeacher = (await query("teachers", "id", (request) => request.eq("user_id", profile.id)))[0];
                teacherClasses = ownTeacher
                    ? (await query("teacher_assignments", "class_id", (request) => request.eq("teacher_id", ownTeacher.id))).map((item) => item.class_id)
                    : [];
            }
            const classIds = profile.role === "student"
                ? [((await rpcOne("current_student_record"))?.class_id)].filter(Boolean)
                : profile.role === "teacher"
                    ? teacherClasses
                    : classes.map((item) => item.id);
            const rows = classIds.length ? await query("timetable_entries", "id, class_id, subject_id, teacher_id, day_of_week, starts_at, ends_at, room, published", (request) => request.in("class_id", classIds).order("day_of_week").order("starts_at")) : [];
            const [classData, subjectData, teacherData] = await Promise.all([
                query("classes", "id, name"),
                query("subjects", "id, name"),
                query("teacher_schedule_directory", "teacher_id, display_name")
            ]);
            scheduleTeachers = teacherData.map((teacher) => ({
                id: teacher.teacher_id,
                person: { display_name: teacher.display_name }
            }));
            window.secureTimetableRows = rows.filter((item) => adminRole || item.published).map((item) => ({
                ...item,
                class: classData.find((c) => c.id === item.class_id),
                subject: subjectData.find((s) => s.id === item.subject_id),
                teacher: teacherData.filter((teacher) => teacher.teacher_id === item.teacher_id).map((teacher) => ({ profile: { display_name: teacher.display_name } }))[0]
            }));
        }

        if (["announcements", "my-announcements"].includes(activeView)) {
            window.secureAnnouncements = await query("announcements", "id, title, body, publish_at, published", (request) => {
                const ordered = request.order("publish_at", { ascending: false });
                return adminRole ? ordered : ordered.eq("published", true).lte("publish_at", new Date().toISOString());
            });
        }

        if (["materials", "my-materials"].includes(activeView)) {
            window.secureMaterials = await query("learning_materials", "id, title, description, class_id, subject_id, storage_path, file_name, published, class:classes(name)", (request) => request.order("created_at", { ascending: false }));
        }

        if (activeView === "results" && profile.role === "teacher") {
            const rows = await query("teacher_results", "id, term, academic_year, continuous_assessment, examination_score, total, grade, published, admission_number, class_name, student_name, subject_name", (request) => request.order("academic_year", { ascending: false }));
            resultRows = rows.map((item) => ({
                ...item,
                student: { admission_number: item.admission_number, class_name: item.class_name, profile: { display_name: item.student_name } },
                subject: { name: item.subject_name }
            }));
        } else if (activeView === "results") {
            const list = await query("results", "id, student_id, subject_id, term, academic_year, continuous_assessment, examination_score, total, grade, published", (request) => request.order("created_at", { ascending: false }));
            const [studentsData, subjectData] = await Promise.all([
                query("student_academic_directory", "id, admission_number, class_id, display_name, class_name"),
                query("subjects", "id, name")
            ]);
            resultDirectory = studentsData;
            const studentById = new Map(studentsData.map((item) => [item.id, {
                ...item,
                profile: { display_name: item.display_name }
            }]));
            resultRows = list.map((item) => ({ ...item, student: studentById.get(item.student_id), subject: subjectData.find((subject) => subject.id === item.subject_id) }));
        }

        navRender();
        let result;
        try {
            result = await pages[activeView]();
        } catch (error) {
            fail(error, "Could not load this section.");
            result = `${heading("PORTAL", "Unable to load this section")}<section class="panel"><p class="empty-state">${esc(error.message || "Check your permissions or database configuration, then retry.")}</p><button class="secondary-button" type="button" data-action="retry">Retry</button></section>`;
        }
        root.innerHTML = result;
    }

    async function createAccount(form) {
        const values = new FormData(form);
        const role = form.dataset.role;
        const payload = {
            role,
            display_name: String(values.get("display_name") || "").trim(),
            username_hint: String(values.get("username_hint") || "").trim() || undefined,
            class_id: String(values.get("class_id") || "") || undefined,
            phone: String(values.get("phone") || "").trim() || undefined,
            date_of_birth: String(values.get("date_of_birth") || "") || undefined
        };
        const result = await invoke("create-account", payload);
        showCredentials(result);
        if (role === "teacher") {
            const classIds = values.getAll("class_ids").filter(Boolean);
            const subjectIds = values.getAll("subject_ids").filter(Boolean);
            if (classIds.length && subjectIds.length) {
                const teacher = (await query("teachers", "id", (request) => request.eq("user_id", result.user_id)))[0];
                if (teacher) {
                    const assignments = classIds.flatMap((classId) => subjectIds.map((subjectId) => ({
                        teacher_id: teacher.id,
                        class_id: classId,
                        subject_id: subjectId
                    })));
                    const { error } = await client.from("teacher_assignments").insert(assignments);
                    if (error) throw new Error(`Account created, but subject assignments failed: ${error.message}`);
                }
            }
        }
        showToast("Account created. Deliver the temporary credentials securely; they are displayed only once.");
        await renderView();
    }

    async function handleSubmit(event) {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        try {
            const values = new FormData(form);
            if (form.id === "create-account-form") {
                event.preventDefault();
                await createAccount(form);
            } else if (form.id === "class-form") {
                event.preventDefault();
                await write("classes", "insert", { name: values.get("name"), department: values.get("department") || null, academic_year: values.get("academic_year") });
                showToast("Class created.");
                await renderView();
            } else if (form.id === "subject-form") {
                event.preventDefault();
                await write("subjects", "insert", { name: values.get("name"), code: values.get("code") || null });
                showToast("Subject created.");
                await renderView();
            } else if (form.id === "result-form") {
                event.preventDefault();
                const ca = Number(values.get("continuous_assessment"));
                const exam = Number(values.get("examination_score"));
                if (ca < 0 || ca > 40 || exam < 0 || exam > 60) throw new Error("CA must be 0–40 and examination marks 0–60.");
                await write("results", "upsert", {
                    student_id: values.get("student_id"),
                    subject_id: values.get("subject_id"),
                    term: values.get("term"),
                    academic_year: values.get("academic_year"),
                    continuous_assessment: ca,
                    examination_score: exam,
                    published: values.get("published") === "on",
                    created_by: profile.id
                }, undefined, "student_id,subject_id,term,academic_year");
                showToast("Result saved. Total and grade were calculated by the database.");
                await renderView();
            } else if (form.id === "fee-form") {
                event.preventDefault();
                await write("fee_items", "insert", {
                    name: values.get("name"),
                    amount: Number(values.get("amount")),
                    academic_year: values.get("academic_year"),
                    class_id: values.get("class_id") || null,
                    due_date: values.get("due_date") || null
                });
                showToast("Fee item created.");
                await renderView();
            } else if (form.id === "payment-form") {
                event.preventDefault();
                await write("payment_records", "insert", {
                    ...Object.fromEntries(["student_id", "fee_item_id", "payment_date", "reference"].map((key) => [key, values.get(key) || null])),
                    amount_paid: Number(values.get("amount_paid")),
                    verified: values.get("verified") === "on",
                    recorded_by: profile.id
                });
                showToast("Payment record saved with the selected verification status.");
                await renderView();
            } else if (form.id === "timetable-form") {
                event.preventDefault();
                await write("timetable_entries", "insert", {
                    class_id: values.get("class_id"),
                    subject_id: values.get("subject_id"),
                    teacher_id: values.get("teacher_id") || null,
                    day_of_week: Number(values.get("day_of_week")),
                    starts_at: values.get("starts_at"),
                    ends_at: values.get("ends_at"),
                    room: values.get("room") || null,
                    published: values.get("published") === "on"
                });
                showToast("Timetable entry saved.");
                await renderView();
            } else if (form.id === "announcement-form") {
                event.preventDefault();
                await write("announcements", "insert", {
                    title: values.get("title"),
                    body: values.get("body"),
                    publish_at: new Date(values.get("publish_at")).toISOString(),
                    published: values.get("published") === "on",
                    created_by: profile.id
                });
                showToast("Announcement saved.");
                await renderView();
            } else if (form.id === "material-form") {
                event.preventDefault();
                const file = values.get("file");
                if (!file || file.size > 20 * 1024 * 1024) throw new Error("Select a document no larger than 20 MB.");
                const path = `${crypto.randomUUID()}/${file.name.replace(/[^\w.-]/g, "_")}`;
                const { error: uploadError } = await client.storage.from("learning-materials").upload(path, file, { contentType: file.type || "application/octet-stream" });
                if (uploadError) throw uploadError;
                await write("learning_materials", "insert", {
                    title: values.get("title"),
                    description: values.get("description") || null,
                    class_id: values.get("class_id") || null,
                    subject_id: values.get("subject_id") || null,
                    storage_path: path,
                    file_name: file.name,
                    published: values.get("published") === "on",
                    uploaded_by: profile.id
                });
                showToast("Learning material uploaded.");
                await renderView();
            } else if (form.id === "password-form") {
                event.preventDefault();
                const password = String(values.get("password"));
                if (password.length < 12 || password !== values.get("confirmation")) throw new Error("Enter matching passwords with at least 12 characters.");
                const { error } = await client.auth.updateUser({ password });
                if (error) throw error;
                form.reset();
                showToast("Password changed successfully.");
            }
        } catch (error) {
            fail(error, "The request could not be completed.");
        }
    }

    let calcCurrent = "0";
    let calcStored = null;
    let calcOperator = null;
    let calcAwaiting = false;
    function calc(button) {
        if (button.dataset.num !== undefined) {
            calcCurrent = calcAwaiting ? button.dataset.num : calcCurrent === "0" ? button.dataset.num : calcCurrent + button.dataset.num;
            calcAwaiting = false;
        } else if (button.dataset.op) {
            if (calcStored !== null && !calcAwaiting) calcEquals();
            calcStored = Number(calcCurrent);
            calcOperator = button.dataset.op;
            calcAwaiting = true;
        } else {
            switch (button.dataset.calc) {
                case "clear": calcCurrent = "0"; calcStored = null; calcOperator = null; calcAwaiting = false; break;
                case "delete": calcCurrent = calcCurrent.length > 1 ? calcCurrent.slice(0, -1) : "0"; break;
                case "percent": calcCurrent = String(Number(calcCurrent) / 100); break;
                case "decimal": if (!calcCurrent.includes(".")) calcCurrent += "."; break;
                case "equals": calcEquals(); break;
            }
        }
        const display = document.getElementById("secure-display");
        if (display) display.textContent = calcCurrent;
    }
    function calcEquals() {
        if (calcStored === null || calcOperator === null || calcAwaiting) return;
        const right = Number(calcCurrent);
        const result = calcOperator === "+" ? calcStored + right
            : calcOperator === "-" ? calcStored - right
            : calcOperator === "*" ? calcStored * right
            : right === 0 ? NaN : calcStored / right;
        calcCurrent = Number.isFinite(result) ? String(Number(result.toPrecision(10))) : "Error";
        calcStored = null;
        calcOperator = null;
        calcAwaiting = true;
    }

    async function takeAction(button) {
        if (button.dataset.view) {
            const route = accountRoutes.find(([view]) => view === button.dataset.view);
            if (!route) return;
            activeView = route[0];
            await renderView();
            return;
        }
        if (button.dataset.num !== undefined || button.dataset.op || button.dataset.calc) {
            calc(button);
            return;
        }
        if (button.dataset.action === "retry") {
            await renderView();
            return;
        }
        if (button.dataset.resetPassword) {
            const result = await invoke("account-action", { action: "reset_password", target_user_id: button.dataset.resetPassword });
            showCredentials(result);
            showToast("Temporary password reset. Deliver the credentials securely.");
            return;
        }
        if (button.dataset.editProfile) {
            const student = roster.find((item) => item.user_id === button.dataset.editProfile);
            const teacher = teachers.find((item) => item.user_id === button.dataset.editProfile);
            let person = student?.person || teacher?.person;
            if (button.dataset.kind === "admin") {
                person = (await query("account_management_directory", "id, display_name", (request) => request.eq("id", button.dataset.editProfile)))[0];
            }
            if (!person) throw new Error("The account profile could not be found.");
            const displayName = prompt("Full name:", person.display_name);
            if (displayName === null) return;
            const payload = {
                action: "update_profile",
                target_user_id: button.dataset.editProfile,
                display_name: displayName.trim()
            };
            if (button.dataset.kind === "student") {
                const currentClass = student.class?.name || "";
                const className = prompt(`Class name (leave blank for unassigned):\n${classes.map((item) => item.name).join(", ")}`, currentClass);
                if (className === null) return;
                const foundClass = classes.find((item) => item.name.toLowerCase() === className.trim().toLowerCase());
                if (className.trim() && !foundClass) throw new Error("Choose one of the classes listed in the prompt.");
                payload.student = { class_id: foundClass?.id || "", phone: student.phone || "" };
            } else if (button.dataset.kind === "teacher") {
                payload.phone = prompt("Phone number:", teacher.phone || "") ?? teacher.phone ?? "";
            }
            await invoke("account-action", payload);
            showToast("Account information updated.");
            await renderView();
            return;
        }
        if (button.dataset.statusUser) {
            const action = button.dataset.status;
            await invoke("account-action", { action: "set_status", target_user_id: button.dataset.statusUser, status: action });
            showToast(`Account status updated to ${action}.`);
            await renderView();
            return;
        }
        if (button.dataset.deleteAccount) {
            if (!confirm("Permanently delete this account and its linked school records?")) return;
            await invoke("account-action", { action: "delete", target_user_id: button.dataset.deleteAccount });
            showToast("Account deleted.");
            await renderView();
            return;
        }
        if (button.dataset.editPermissions) {
            const target = button.dataset.editPermissions;
            const person = await query("account_management_directory", "id, display_name, permissions", (request) => request.eq("id", target));
            const current = person[0]?.permissions || {};
            const choices = PERMISSIONS.map(([key, label]) => `${label}: ${current[key] === true ? "yes" : "no"}`).join("\n");
            const input = prompt(`Enter permission names to enable, separated by commas.\n\nAvailable:\n${PERMISSIONS.map(([key, label]) => `${key} — ${label}`).join("\n")}\n\nCurrently enabled: ${choices}`);
            if (input === null) return;
            const requested = new Set(input.split(",").map((item) => item.trim()).filter(Boolean));
            const permissions = Object.fromEntries(PERMISSIONS.map(([key]) => [key, requested.has(key)]));
            await invoke("account-action", { action: "update_permissions", target_user_id: target, permissions });
            showToast("Administrator permissions updated.");
            await renderView();
            return;
        }
        if (button.dataset.publishResult) {
            const published = button.dataset.published !== "true";
            const { error } = await client.from("results").update({ published }).eq("id", button.dataset.publishResult);
            if (error) throw error;
            showToast(published ? "Result published." : "Result unpublished.");
            await renderView();
            return;
        }
        if (button.dataset.editResult) {
            const result = resultRows.find((item) => item.id === button.dataset.editResult);
            const form = root.querySelector("#result-form");
            if (!result || !form) return;
            form.elements.student_id.value = result.student_id;
            form.elements.subject_id.value = result.subject_id;
            form.elements.term.value = result.term;
            form.elements.academic_year.value = result.academic_year;
            form.elements.continuous_assessment.value = result.continuous_assessment;
            form.elements.examination_score.value = result.examination_score;
            form.elements.published.checked = result.published;
            form.scrollIntoView({ behavior: "smooth", block: "center" });
            showToast("Edit the values and save; the existing student, subject, term and year record will be updated.");
            return;
        }
        if (button.dataset.editRow) {
            const tableName = button.dataset.editRow;
            const id = button.dataset.id;
            let values;
            if (tableName === "classes") {
                const item = classes.find((row) => row.id === id);
                const name = prompt("Class name:", item?.name || "");
                if (name === null) return;
                const department = prompt("Department:", item?.department || "");
                if (department === null) return;
                const academicYear = prompt("Academic year:", item?.academic_year || "");
                if (academicYear === null) return;
                values = { name: name.trim(), department: department.trim() || null, academic_year: academicYear.trim() };
            } else if (tableName === "subjects") {
                const item = subjects.find((row) => row.id === id);
                const name = prompt("Subject name:", item?.name || "");
                if (name === null) return;
                const code = prompt("Subject code:", item?.code || "");
                if (code === null) return;
                values = { name: name.trim(), code: code.trim() || null };
            } else if (tableName === "fee_items") {
                const item = fees.find((row) => row.id === id);
                const name = prompt("Fee name:", item?.name || "");
                if (name === null) return;
                const amount = prompt("Fee amount:", String(item?.amount || ""));
                if (amount === null) return;
                const dueDate = prompt("Due date (YYYY-MM-DD, blank for none):", item?.due_date || "");
                if (dueDate === null) return;
                values = { name: name.trim(), amount: Number(amount), due_date: dueDate || null };
                if (!Number.isFinite(values.amount) || values.amount < 0) throw new Error("Enter a valid non-negative fee amount.");
            } else if (tableName === "timetable_entries") {
                const item = (window.secureTimetableRows || []).find((row) => row.id === id);
                if (!item) return;
                const starts = prompt("Lesson start time (HH:MM):", item.starts_at.slice(0, 5));
                if (starts === null) return;
                const ends = prompt("Lesson end time (HH:MM):", item.ends_at.slice(0, 5));
                if (ends === null) return;
                const room = prompt("Room:", item.room || "");
                if (room === null) return;
                values = { starts_at: starts, ends_at: ends, room: room || null };
                if (ends <= starts) throw new Error("Lesson end time must be after its start time.");
            } else if (tableName === "announcements") {
                const item = (window.secureAnnouncements || []).find((row) => row.id === id);
                if (!item) return;
                const title = prompt("Announcement title:", item.title);
                if (title === null) return;
                const body = prompt("Announcement message:", item.body);
                if (body === null) return;
                values = { title: title.trim(), body: body.trim() };
            } else if (tableName === "learning_materials") {
                const item = (window.secureMaterials || []).find((row) => row.id === id);
                if (!item) return;
                const title = prompt("Material title:", item.title);
                if (title === null) return;
                const publish = confirm(item.published
                    ? "The material is currently published. Keep it published? Choose Cancel to unpublish."
                    : "Publish this material to the selected students?");
                values = { title: title.trim(), published: publish };
            } else {
                return;
            }
            const { error } = await client.from(tableName).update(values).eq("id", id);
            if (error) throw error;
            showToast("Record updated.");
            await renderView();
            return;
        }
        if (button.dataset.verifyPayment) {
            if (!confirm("Confirm that the school has received and verified this payment?")) return;
            const { error } = await client.from("payment_records").update({ verified: true }).eq("id", button.dataset.verifyPayment);
            if (error) throw error;
            showToast("Payment marked verified by an authorized administrator.");
            await renderView();
            return;
        }
        if (button.dataset.deleteRow) {
            if (!confirm("Delete this record?")) return;
            const { error } = await client.from(button.dataset.deleteRow).delete().eq("id", button.dataset.id);
            if (error) throw error;
            showToast("Record deleted.");
            await renderView();
            return;
        }
        if (button.dataset.downloadMaterial) {
            const item = (window.secureMaterials || []).find((material) => material.id === button.dataset.downloadMaterial);
            if (!item) throw new Error("The learning material was not found.");
            const { data, error } = await client.storage.from("learning-materials").createSignedUrl(item.storage_path, 60);
            if (error) throw error;
            window.open(data.signedUrl, "_blank", "noopener,noreferrer");
        }
    }

    nav.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-view]");
        if (button) takeAction(button).catch((error) => fail(error, "Could not open this section."));
    });
    root.addEventListener("submit", (event) => handleSubmit(event));
    document.getElementById("close-credentials").addEventListener("click", () => {
        document.getElementById("credential-dialog").close();
    });
    document.getElementById("copy-credentials").addEventListener("click", async () => {
        const text = `Username: ${document.getElementById("credential-username").textContent}\nTemporary password: ${document.getElementById("credential-password").textContent}\nExpires: ${document.getElementById("credential-expiry").textContent}`;
        try {
            await navigator.clipboard.writeText(text);
            showToast("Temporary credentials copied. Share them securely.");
        } catch (error) {
            fail(error, "Could not copy credentials. Select the values and copy them manually.");
        }
    });
    root.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (button) takeAction(button).catch((error) => fail(error, "The request could not be completed."));
    });
    function filterStudents() {
        const search = root.querySelector('[data-search="students"]')?.value.toLocaleLowerCase() || "";
        const selectedClass = root.querySelector('[data-filter="class"]')?.value || "";
        const selectedStatus = root.querySelector('[data-filter="status"]')?.value || "";
        root.querySelectorAll("tbody tr[data-student-class]").forEach((row) => {
            row.hidden = !row.textContent.toLocaleLowerCase().includes(search)
                || (selectedClass && row.dataset.studentClass !== selectedClass)
                || (selectedStatus && row.dataset.studentStatus !== selectedStatus);
        });
    }
    root.addEventListener("input", (event) => {
        if (event.target.matches('[data-search="students"]')) filterStudents();
    });
    root.addEventListener("change", (event) => {
        if (event.target.matches('[data-filter="class"], [data-filter="status"]')) filterStudents();
    });
    document.getElementById("logout-button").addEventListener("click", async () => {
        const { error } = await client.auth.signOut();
        if (error) {
            fail(error, "Could not securely end the session.");
            return;
        }
        window.location.replace("index.html");
    });

    try {
        await renderView();
    } catch (error) {
        fail(error, "The school portal could not load.");
        root.innerHTML = `${heading("PORTAL", "Unable to load school data")}<section class="panel"><p class="empty-state">${esc(error.message)}</p><button class="secondary-button" type="button" data-action="retry">Retry</button></section>`;
    }
}
