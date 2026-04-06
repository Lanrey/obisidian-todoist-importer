import { Notice, Setting, requestUrl } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';

const TODOIST_BASE_URL = 'https://api.todoist.com/api/v1';
const TASK_FETCH_LIMIT = 200;

// Todoist priority values: 4 = p1 (urgent), 3 = p2 (high), 2 = p3 (medium), 1 = p4 (normal).
// Emoji follow the Obsidian Tasks plugin convention so imported tasks work with it out of the box.
const PRIORITY_EMOJI: Record<number, string> = {
	4: '⏫', // p1 urgent
	3: '🔼', // p2 high
	2: '🔽', // p3 medium
	1: '',   // p4 normal — no marker
};

interface TodoistProject {
	id: string;
	name: string;
	color: string;
	parent_id: string | null;
	order: number;
	url: string;
}

interface TodoistSection {
	id: string;
	project_id: string;
	name: string;
	order: number;
}

interface TodoistDue {
	date: string;        // YYYY-MM-DD
	time?: string;       // HH:MM:SS when a time is set
	timezone?: string;
	is_recurring: boolean;
	string?: string;     // Human-readable representation
}

interface TodoistTask {
	id: string;
	project_id: string;
	section_id: string | null;
	content: string;
	description: string;
	is_completed: boolean;
	labels: string[];
	priority: number;
	due: TodoistDue | null;
	parent_id: string | null;
	order: number;
	created_at: string;
	url: string;
}

interface TodoistComment {
	id: string;
	task_id: string;
	content: string;
	posted_at: string;
}

// All paginated list endpoints share this envelope
interface TodoistPagedResponse<T> {
	results: T[];
	next_cursor: string | null;
}

export class TodoistImporter extends FormatImporter {
	private apiToken: string = '';
	private importComments: boolean = false;
	private projects: TodoistProject[] = [];
	private selectedProjectIds: Set<string> = new Set();
	private projectListEl: HTMLElement | null = null;
	private loadButton: any = null;

	init() {
		this.addOutputLocationSetting('Todoist');

		new Setting(this.modal.contentEl)
			.setName('API token')
			.setDesc(this.createTokenDescription())
			.addText(text => {
				text
					.setPlaceholder('Your Todoist API token')
					.setValue(this.apiToken)
					.onChange(value => { this.apiToken = value.trim(); });
				// Mask as password so the token is not visible on screen
				text.inputEl.type = 'password';
			});

		new Setting(this.modal.contentEl)
			.setName('Projects to import')
			.setDesc('Click "Load" to list your projects, then select which ones to import.')
			.addButton(button => {
				this.loadButton = button;
				button
					.setButtonText('Load')
					.setCta()
					.onClick(async () => { await this.loadProjects(); });
			});

		// Scrollable container for project checkboxes
		this.projectListEl = this.modal.contentEl.createDiv();
		this.projectListEl.style.maxHeight = '200px';
		this.projectListEl.style.overflowY = 'auto';
		this.projectListEl.style.border = '1px solid var(--background-modifier-border)';
		this.projectListEl.style.borderRadius = 'var(--radius-s)';
		this.projectListEl.style.padding = 'var(--size-4-2)';
		this.projectListEl.style.marginBottom = 'var(--size-4-2)';
		this.projectListEl.createDiv({
			text: 'Click "Load" to load your Todoist projects.',
			cls: 'setting-item-description',
		});

		new Setting(this.modal.contentEl)
			.setName('Import task comments')
			.setDesc('Fetch and include comments for each task. This makes one additional API call per task that has comments.')
			.addToggle(toggle => toggle
				.setValue(false)
				.onChange(value => { this.importComments = value; }));
	}

	private createTokenDescription(): DocumentFragment {
		const frag = document.createDocumentFragment();
		frag.appendText('Your personal API token. Find it in ');
		frag.createEl('a', {
			text: 'Todoist Settings → Integrations → Developer',
			href: 'https://todoist.com/app/settings/integrations/developer',
		});
		frag.appendText('.');
		return frag;
	}

	private async loadProjects(): Promise<void> {
		if (!this.apiToken) {
			new Notice('Please enter your Todoist API token first.');
			return;
		}

		if (this.loadButton) {
			this.loadButton.setDisabled(true);
			this.loadButton.setButtonText('Loading...');
		}

		try {
			this.projects = await this.fetchProjects();
			this.renderProjectList();
		}
		catch (e) {
			new Notice(`Failed to load projects: ${e instanceof Error ? e.message : String(e)}`);
		}
		finally {
			if (this.loadButton) {
				this.loadButton.setDisabled(false);
				this.loadButton.setButtonText('Refresh');
			}
		}
	}

	private renderProjectList(): void {
		if (!this.projectListEl) return;
		this.projectListEl.empty();

		if (this.projects.length === 0) {
			this.projectListEl.createEl('p', {
				text: 'No projects found.',
				cls: 'setting-item-description',
			});
			return;
		}

		for (const project of this.projects) {
			const row = this.projectListEl.createDiv();
			row.style.padding = '4px 0';

			const label = row.createEl('label');
			label.style.display = 'flex';
			label.style.alignItems = 'center';
			label.style.gap = '8px';
			label.style.cursor = 'pointer';

			const checkbox = label.createEl('input');
			checkbox.type = 'checkbox';
			checkbox.checked = this.selectedProjectIds.has(project.id);
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					this.selectedProjectIds.add(project.id);
				}
				else {
					this.selectedProjectIds.delete(project.id);
				}
			});

			// Indent children visually
			if (project.parent_id) {
				label.style.paddingLeft = '20px';
			}

			label.appendText(project.name);
		}
	}

	async import(ctx: ImportContext): Promise<void> {
		if (!this.apiToken) {
			new Notice('Please enter your Todoist API token.');
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		// Load projects if the user clicked Import without using the Load button first
		if (this.projects.length === 0) {
			ctx.status('Loading projects...');
			try {
				this.projects = await this.fetchProjects();
			}
			catch (e) {
				new Notice(`Failed to load projects: ${e instanceof Error ? e.message : String(e)}`);
				return;
			}
		}

		const projectsToImport = this.selectedProjectIds.size > 0
			? this.projects.filter(p => this.selectedProjectIds.has(p.id))
			: this.projects;

		if (projectsToImport.length === 0) {
			new Notice('No projects to import.');
			return;
		}

		ctx.reportProgress(0, projectsToImport.length);

		for (let i = 0; i < projectsToImport.length; i++) {
			if (ctx.isCancelled()) return;

			const project = projectsToImport[i];
			ctx.status(`Importing "${project.name}"...`);

			try {
				await this.importProject(ctx, project, folder);
				ctx.reportNoteSuccess(project.name);
			}
			catch (e) {
				ctx.reportFailed(project.name, e);
			}

			ctx.reportProgress(i + 1, projectsToImport.length);
		}
	}

	private async importProject(ctx: ImportContext, project: TodoistProject, outputFolder: any): Promise<void> {
		ctx.status(`Fetching sections for "${project.name}"...`);
		const sections = await this.fetchSections(project.id);

		ctx.status(`Fetching tasks for "${project.name}"...`);
		const allTasks = await this.fetchAllTasks(project.id);

		// Comments require one API call per task — only do this if the user opted in
		const commentsMap = new Map<string, TodoistComment[]>();
		if (this.importComments) {
			for (const task of allTasks) {
				if (ctx.isCancelled()) return;
				try {
					const comments = await this.fetchTaskComments(task.id);
					if (comments.length > 0) {
						commentsMap.set(task.id, comments);
					}
				}
				catch (e) {
					// Non-fatal: continue without comments for this task
					console.warn(`Failed to fetch comments for task "${task.content}":`, e);
				}
			}
		}

		const content = this.buildProjectMarkdown(project, sections, allTasks, commentsMap);
		await this.saveAsMarkdownFile(outputFolder, project.name, content);
	}

	/**
	 * Converts a Todoist project into a Markdown document.
	 *
	 * Structure:
	 *   - YAML frontmatter with project metadata
	 *   - Tasks with no section rendered first
	 *   - Each section as a `##` heading, followed by its tasks
	 *   - Tasks rendered as Obsidian checkboxes with priority emoji, due date, and label tags
	 *   - Subtasks indented under their parent
	 *   - Optional comments rendered as blockquotes beneath the task
	 */
	private buildProjectMarkdown(
		project: TodoistProject,
		sections: TodoistSection[],
		tasks: TodoistTask[],
		commentsMap: Map<string, TodoistComment[]>
	): string {
		const lines: string[] = [];

		// --- Frontmatter ---
		lines.push('---');
		lines.push(`todoist-id: "${project.id}"`);
		lines.push(`url: "${project.url}"`);
		if (project.color) lines.push(`color: ${project.color}`);
		lines.push('---');
		lines.push('');

		// Pre-compute lookup structures
		const taskById = new Map<string, TodoistTask>();
		const childrenByParentId = new Map<string, TodoistTask[]>();

		for (const task of tasks) {
			taskById.set(task.id, task);
		}

		for (const task of tasks) {
			if (task.parent_id !== null) {
				const siblings = childrenByParentId.get(task.parent_id) ?? [];
				siblings.push(task);
				childrenByParentId.set(task.parent_id, siblings);
			}
		}

		// Sort children by their display order
		for (const children of childrenByParentId.values()) {
			children.sort((a, b) => a.order - b.order);
		}

		// Group top-level tasks by section (null = no section)
		const tasksBySection = new Map<string | null, TodoistTask[]>();
		tasksBySection.set(null, []);
		for (const section of sections) {
			tasksBySection.set(section.id, []);
		}

		for (const task of tasks) {
			if (task.parent_id !== null) continue; // subtasks are rendered recursively
			const bucket = tasksBySection.get(task.section_id) ?? tasksBySection.get(null)!;
			bucket.push(task);
		}

		const renderTask = (task: TodoistTask, depth: number): void => {
			const indent = '  '.repeat(depth);
			const check = task.is_completed ? '[x]' : '[ ]';

			let line = `${indent}- ${check} ${task.content}`;

			const priorityEmoji = PRIORITY_EMOJI[task.priority];
			if (priorityEmoji) line += ` ${priorityEmoji}`;

			if (task.due) {
				// Include time component when present (ISO 8601 local datetime)
				const dueStr = task.due.time
					? `${task.due.date}T${task.due.time}`
					: task.due.date;
				line += ` 📅 ${dueStr}`;
				if (task.due.is_recurring) line += ' 🔁';
			}

			// Labels become inline tags; spaces in label names are converted to underscores
			if (task.labels.length > 0) {
				line += ' ' + task.labels.map(l => `#${l.replace(/\s+/g, '_')}`).join(' ');
			}

			lines.push(line);

			// Multi-line description: indent each line to sit under the checkbox
			if (task.description && task.description.trim()) {
				for (const descLine of task.description.split('\n')) {
					lines.push(`${indent}  ${descLine}`);
				}
			}

			// Comments as blockquotes
			const comments = commentsMap.get(task.id);
			if (comments) {
				for (const comment of comments) {
					// Indent blockquote lines to match the task depth
					const quoted = comment.content
						.split('\n')
						.map(l => `${indent}  > ${l}`)
						.join('\n');
					lines.push(quoted);
				}
			}

			// Render subtasks recursively
			const children = childrenByParentId.get(task.id);
			if (children) {
				for (const child of children) {
					renderTask(child, depth + 1);
				}
			}
		};

		// --- Tasks with no section ---
		const unsectionedTasks = (tasksBySection.get(null) ?? [])
			.sort((a, b) => a.order - b.order);

		if (unsectionedTasks.length > 0) {
			for (const task of unsectionedTasks) {
				renderTask(task, 0);
			}
			lines.push('');
		}

		// --- Sections ---
		const sortedSections = [...sections].sort((a, b) => a.order - b.order);

		for (const section of sortedSections) {
			lines.push(`## ${section.name}`);
			lines.push('');

			const sectionTasks = (tasksBySection.get(section.id) ?? [])
				.sort((a, b) => a.order - b.order);

			if (sectionTasks.length === 0) {
				lines.push('*(no tasks)*');
			}
			else {
				for (const task of sectionTasks) {
					renderTask(task, 0);
				}
			}
			lines.push('');
		}

		return lines.join('\n');
	}

	// --- API helpers ---

	/**
	 * Makes a GET request to the Todoist API and returns the parsed JSON response.
	 * Converts HTTP errors to thrown exceptions with human-readable messages.
	 */
	private async apiGet<T>(path: string, params?: Record<string, string>): Promise<T> {
		let url = `${TODOIST_BASE_URL}${path}`;
		if (params) {
			const qs = new URLSearchParams(params).toString();
			if (qs) url += '?' + qs;
		}

		const response = await requestUrl({
			url,
			method: 'GET',
			headers: { 'Authorization': `Bearer ${this.apiToken}` },
			throw: false,
		});

		if (response.status === 401) {
			throw new Error('Invalid API token. Please check your Todoist API token in Settings → Integrations → Developer.');
		}
		if (response.status === 403) {
			throw new Error('Access denied. Your token may lack the required permissions.');
		}
		if (response.status === 429) {
			throw new Error('Todoist API rate limit exceeded. Please wait a moment and try again.');
		}
		if (response.status >= 400) {
			let message = `Todoist API error (HTTP ${response.status})`;
			try {
				const body = response.json;
				if (body?.error) message += `: ${body.error}`;
			}
			catch { /* ignore parse failures */ }
			throw new Error(message);
		}

		return response.json as T;
	}

	private async fetchProjects(): Promise<TodoistProject[]> {
		const response = await this.apiGet<TodoistPagedResponse<TodoistProject> | TodoistProject[]>('/projects');
		// API v1 returns { results: [...], next_cursor: ... }; handle both shapes defensively
		if (Array.isArray(response)) return response;
		return (response as TodoistPagedResponse<TodoistProject>).results ?? [];
	}

	private async fetchSections(projectId: string): Promise<TodoistSection[]> {
		const response = await this.apiGet<TodoistPagedResponse<TodoistSection> | TodoistSection[]>(
			'/sections', { project_id: projectId }
		);
		if (Array.isArray(response)) return response;
		return (response as TodoistPagedResponse<TodoistSection>).results ?? [];
	}

	/**
	 * Fetches all tasks for a project, following cursor-based pagination until exhausted.
	 */
	private async fetchAllTasks(projectId: string): Promise<TodoistTask[]> {
		const tasks: TodoistTask[] = [];
		let cursor: string | null = null;

		do {
			const params: Record<string, string> = {
				project_id: projectId,
				limit: String(TASK_FETCH_LIMIT),
			};
			if (cursor) params.cursor = cursor;

			const response = await this.apiGet<TodoistPagedResponse<TodoistTask>>('/tasks', params);
			tasks.push(...response.results);
			cursor = response.next_cursor ?? null;
		} while (cursor);

		return tasks;
	}

	private async fetchTaskComments(taskId: string): Promise<TodoistComment[]> {
		const response = await this.apiGet<TodoistPagedResponse<TodoistComment> | TodoistComment[]>(
			'/comments', { task_id: taskId }
		);
		if (Array.isArray(response)) return response;
		return (response as TodoistPagedResponse<TodoistComment>).results ?? [];
	}
}
