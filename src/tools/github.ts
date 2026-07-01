import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Tool } from '../bus/toolbus.js';
import { getSecret } from '../config/secrets.js';

const execFileAsync = promisify(execFile);
const API = 'https://api.github.com';

async function token(): Promise<string> {
  const saved = await getSecret('github.token');
  if (saved) return saved;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 10000 });
  const t = stdout.trim();
  if (!t) throw new Error('No GitHub token found. Run gh auth login or set github.token.');
  return t;
}

function splitRepo(input: { repo?: string; owner?: string; name?: string }) {
  if (input.repo) {
    const [owner, name] = input.repo.split('/');
    if (owner && name) return { owner, name };
  }
  if (input.owner && input.name) return { owner: input.owner, name: input.name };
  throw new Error('Provide repo as owner/name, or owner + name.');
}

function qs(params: Record<string, any>) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') out.set(k, String(v));
  }
  const s = out.toString();
  return s ? `?${s}` : '';
}

async function gh(path: string, opts: { method?: string; body?: any; accept?: string } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method || 'GET',
    headers: {
      Accept: opts.accept || 'application/vnd.github+json',
      Authorization: `Bearer ${await token()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${text.slice(0, 1000)}`);
  if (opts.accept?.includes('diff')) return text;
  return text ? JSON.parse(text) : { ok: true, status: res.status };
}

function tool(name: string, description: string, riskLevel: Tool['riskLevel'], execute: Tool['execute']): Tool {
  return {
    name,
    description,
    tags: ['github', riskLevel === 'low' ? 'read' : 'write'],
    riskLevel,
    timeout: 30000,
    redactArgs: ['token'],
    schema: { type: 'object', properties: {}, required: [] },
    execute,
  };
}

export const githubTools: Tool[] = [
  tool('github_search', 'Search GitHub repositories, issues, or code.', 'low', async (a) => {
    const type = a.type || 'repositories';
    const endpoint = type === 'code' ? 'code' : type === 'issues' ? 'issues' : 'repositories';
    return gh(`/search/${endpoint}${qs({ q: a.query, per_page: a.limit ?? 10 })}`);
  }),
  tool('github_repo_list', 'List repositories for a user or organization.', 'low', async (a) => {
    const owner = a.owner || a.user || a.org;
    if (!owner) return gh(`/user/repos${qs({ per_page: a.limit ?? 30, sort: 'updated' })}`);
    const first = await gh(`/users/${owner}/repos${qs({ per_page: a.limit ?? 30, sort: 'updated' })}`).catch(() => null);
    return first || gh(`/orgs/${owner}/repos${qs({ per_page: a.limit ?? 30, sort: 'updated' })}`);
  }),
  tool('github_repo_info', 'Get repository metadata.', 'low', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}`);
  }),
  tool('github_repo_create', 'Create a GitHub repository.', 'high', async (a) => {
    const body = {
      name: a.name,
      description: a.description,
      private: a.private ?? true,
      auto_init: a.auto_init ?? false,
    };
    return a.org ? gh(`/orgs/${a.org}/repos`, { method: 'POST', body }) : gh('/user/repos', { method: 'POST', body });
  }),
  tool('github_repo_index', 'List a repository tree recursively for codebase indexing.', 'low', async (a) => {
    const r = splitRepo(a);
    const repo = await gh(`/repos/${r.owner}/${r.name}`);
    const tree = await gh(`/repos/${r.owner}/${r.name}/git/trees/${a.ref || repo.default_branch}?recursive=1`);
    return { repo: repo.full_name, default_branch: repo.default_branch, tree: tree.tree?.slice(0, a.limit ?? 1000) };
  }),
  tool('github_file_read', 'Read a file or directory from a repository.', 'low', async (a) => {
    const r = splitRepo(a);
    const p = encodeURIComponent(a.path || '').replace(/%2F/g, '/');
    const data = await gh(`/repos/${r.owner}/${r.name}/contents/${p}${qs({ ref: a.ref })}`);
    if (!Array.isArray(data) && data.content && data.encoding === 'base64') {
      return { ...data, decoded: Buffer.from(data.content, 'base64').toString('utf8') };
    }
    return data;
  }),
  tool('github_file_write', 'Create or update a file in a repository.', 'high', async (a) => {
    const r = splitRepo(a);
    const p = encodeURIComponent(a.path).replace(/%2F/g, '/');
    let sha = a.sha;
    if (!sha) {
      const existing = await gh(`/repos/${r.owner}/${r.name}/contents/${p}${qs({ ref: a.branch })}`).catch(() => null);
      sha = existing?.sha;
    }
    return gh(`/repos/${r.owner}/${r.name}/contents/${p}`, {
      method: 'PUT',
      body: {
        message: a.message || `Update ${a.path}`,
        content: Buffer.from(a.content || '').toString('base64'),
        branch: a.branch,
        sha,
      },
    });
  }),
  tool('github_gist_create', 'Create a GitHub gist.', 'high', async (a) =>
    gh('/gists', {
      method: 'POST',
      body: {
        description: a.description || '',
        public: a.public ?? false,
        files: { [a.filename || 'gist.txt']: { content: a.content || '' } },
      },
    })
  ),
  tool('github_issue_list', 'List issues for a repository.', 'low', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/issues${qs({ state: a.state || 'open', labels: a.labels, per_page: a.limit ?? 30 })}`);
  }),
  tool('github_issue_create', 'Create an issue.', 'high', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/issues`, { method: 'POST', body: { title: a.title, body: a.body, labels: a.labels, assignees: a.assignees } });
  }),
  tool('github_issue_update', 'Update an issue.', 'high', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/issues/${a.issue_number || a.number}`, { method: 'PATCH', body: a.update || a });
  }),
  tool('github_comment_list', 'List issue comments.', 'low', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/issues/${a.issue_number || a.number}/comments${qs({ per_page: a.limit ?? 30 })}`);
  }),
  tool('github_pr_list', 'List pull requests.', 'low', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/pulls${qs({ state: a.state || 'open', head: a.head, base: a.base, per_page: a.limit ?? 30 })}`);
  }),
  tool('github_pr_create', 'Create a pull request.', 'high', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/pulls`, { method: 'POST', body: { title: a.title, body: a.body, head: a.head, base: a.base, draft: a.draft } });
  }),
  tool('github_pr_diff', 'Get a pull request diff.', 'low', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/pulls/${a.pull_number || a.number}`, { accept: 'application/vnd.github.v3.diff' });
  }),
  tool('github_pr_review', 'Submit a pull request review.', 'high', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/pulls/${a.pull_number || a.number}/reviews`, {
      method: 'POST',
      body: { body: a.body, event: a.event || 'COMMENT', comments: a.comments },
    });
  }),
  tool('github_pr_merge', 'Merge a pull request.', 'high', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/pulls/${a.pull_number || a.number}/merge`, {
      method: 'PUT',
      body: { commit_title: a.commit_title, commit_message: a.commit_message, merge_method: a.merge_method || 'merge' },
    });
  }),
  tool('github_pr_comment_list', 'List pull request review comments.', 'low', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/pulls/${a.pull_number || a.number}/comments${qs({ per_page: a.limit ?? 30 })}`);
  }),
  tool('github_pr_comment_create', 'Create a pull request review comment.', 'high', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/pulls/${a.pull_number || a.number}/comments`, {
      method: 'POST',
      body: { body: a.body, commit_id: a.commit_id, path: a.path, line: a.line, side: a.side || 'RIGHT' },
    });
  }),
  tool('github_branch_list', 'List repository branches.', 'low', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/branches${qs({ per_page: a.limit ?? 100 })}`);
  }),
  tool('github_branch_create', 'Create a branch from a SHA or existing branch.', 'high', async (a) => {
    const r = splitRepo(a);
    let sha = a.sha;
    if (!sha) {
      const ref = await gh(`/repos/${r.owner}/${r.name}/git/ref/heads/${a.from || 'main'}`);
      sha = ref.object.sha;
    }
    return gh(`/repos/${r.owner}/${r.name}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${a.branch}`, sha } });
  }),
  tool('github_commit_list', 'List commits.', 'low', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/commits${qs({ sha: a.sha || a.branch, path: a.path, since: a.since, until: a.until, per_page: a.limit ?? 30 })}`);
  }),
  tool('github_release_list', 'List releases.', 'low', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/releases${qs({ per_page: a.limit ?? 30 })}`);
  }),
  tool('github_release_create', 'Create a release.', 'high', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/releases`, {
      method: 'POST',
      body: { tag_name: a.tag_name || a.tag, name: a.name, body: a.body, draft: a.draft ?? false, prerelease: a.prerelease ?? false },
    });
  }),
  tool('github_actions_list', 'List GitHub Actions workflow runs.', 'low', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/actions/runs${qs({ branch: a.branch, status: a.status, event: a.event, per_page: a.limit ?? 30 })}`);
  }),
  tool('github_actions_trigger', 'Trigger a workflow_dispatch run.', 'high', async (a) => {
    const r = splitRepo(a);
    return gh(`/repos/${r.owner}/${r.name}/actions/workflows/${a.workflow_id || a.workflow}/dispatches`, {
      method: 'POST',
      body: { ref: a.ref || a.branch || 'main', inputs: a.inputs || {} },
    });
  }),
];
