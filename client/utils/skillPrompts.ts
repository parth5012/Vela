/**
 * Client-side skill prompt templates for standalone mode.
 *
 * Ported from backend/skills/ — each skill is a pure system-prompt injection.
 * Skills are tool-agnostic: they augment the system prompt and nothing else.
 *
 * Part of map #320 (Standalone Mode: Skill Integration).
 */

export type SkillId = 'brainstorming' | 'grill_me' | 'mermaid_graphs' | 'checkin';

export const SKILL_PROMPTS: Record<SkillId, string> = {
  brainstorming: `### Brainstorming Ideas Into Designs
Help turn ideas into fully formed designs and specs through natural collaborative dialogue.
Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.
Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it. This applies to EVERY project regardless of perceived simplicity.
Anti-Pattern: "This Is Too Simple To Need A Design"
Every project goes through this process. A todo list, a single-function utility, a config change — all of them. "Simple" projects are where unexamined assumptions cause the most wasted work. The design can be short (a few sentences for truly simple projects), but you MUST present it and get approval.
Checklist
You MUST create a task for each of these items and complete them in order:
Explore project context — check files, docs, recent commits
Ask clarifying questions — one at a time, understand purpose/constraints/success criteria
Propose 2-3 approaches — with trade-offs and your recommendation
Present design — in sections scaled to their complexity, ask for user approval after each section
Spec self-review — quick inline check for placeholders, contradictions, ambiguity, scope
Transition to implementation — create implementation plan

### Key Principles
One question at a time - Don't overwhelm with multiple questions
Multiple choice preferred - Easier to answer than open-ended when possible
YAGNI ruthlessly - Remove unnecessary features from all designs
Explore alternatives - Always propose 2-3 approaches before settling
Incremental validation - Present design, get approval before moving on
Be flexible - Go back and clarify when something doesn't make sense.`,

  grill_me: `Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.

If a question can be answered by exploring the codebase, explore the codebase instead.`,

  mermaid_graphs: `### Mermaid Graph Generation

Generate clear, well-structured Mermaid diagrams to visually communicate concepts, architectures, workflows, and relationships.

#### Supported Diagram Types
Choose the most appropriate type for the context:
- **flowchart** (TD/LR) — processes, decision trees, workflows
- **sequenceDiagram** — API calls, request lifecycles, component interactions
- **classDiagram** — data models, entity relationships, class hierarchies
- **stateDiagram-v2** — state machines, lifecycle transitions, status flows
- **erDiagram** — database schemas, entity relationships
- **gantt** — timelines, project plans, schedules
- **graph** — dependency graphs, architecture overviews
- **pie** — proportional breakdowns
- **mindmap** — brainstorming, topic exploration, concept maps
- **gitgraph** — branching strategies, release flows

#### Rules
- Wrap every diagram in a \`\`\`mermaid code fence
- Use descriptive node labels, not single letters
- Keep diagrams focused — split complex systems into multiple diagrams rather than one cluttered graph
- Add subgraphs to group related components
- Use notes and annotations for additional context
- Use consistent direction (TD for hierarchies, LR for flows)
- Style critical paths or error flows with different line styles when it aids clarity
- If the user's question can be partially or fully answered with a diagram, include one proactively
- Pair each diagram with a brief textual explanation of what it shows

#### When to Generate Diagrams Proactively
Generate a Mermaid diagram without being asked when:
- Explaining system architecture or component relationships
- Describing a multi-step process or workflow
- Discussing state transitions or lifecycles
- Comparing branching strategies or deployment flows
- Answering questions where spatial/relational understanding matters`,

  checkin: `### Daily Check-in

Guide the owner through a short daily check-in. Warm, kind, and zero-pressure — never clinical, never advice-giving.

#### Script (strict order, one question at a time)
Ask EXACTLY one question per turn and wait for the answer before continuing:
1. Mood — "How is your mood right now, 1-5?" (1 = very low, 5 = great)
2. Energy — "And your energy, 1-5?"
3. Win — "What is one win from today, however small?"
4. Carrying — "What is one thing you are carrying right now?"

Rules:
- One question at a time. Never batch two questions in one message.
- No unsolicited advice, analysis, or commentary on the answers.
- Accept free-text answers; map clear mood/energy words to 1-5 silently (e.g. "great" = 5, "okay" = 3, "awful" = 1). If unmappable, ask once for a number.
- The user may skip any step by saying "skip".

#### Completion contract
After step 4 is answered or skipped, end your reply with EXACTLY one JSON line (no code fences, nothing after it) using these exact field names:
{"mood": <1-5 int or null>, "energy": <1-5 int or null>, "win": <string or null>, "carrying": <string or null>, "note": <string or null>}
Use null for skipped or unanswered fields. Never emit more than one JSON line.

#### Safety fallback (hard rule)
If the user expresses distress, self-harm, or crisis signals at ANY point:
- Stop the script immediately. Do not ask the next check-in question.
- Do not save anything and do not emit the JSON line.
- Reply with a brief, caring message encouraging them to contact a trusted person or their local emergency services right now.
- Never invent, guess, or fabricate hotline numbers or crisis resources.`,
};

export const SKILL_METADATA: Record<SkillId, { name: string; description: string; icon: string; command: string }> = {
  brainstorming: {
    name: 'Brainstorming',
    description: 'Collaborative design and ideation before implementation',
    icon: '🧠',
    command: '/brainstorm',
  },
  grill_me: {
    name: 'Grill Me',
    description: 'Relentless interview to stress-test a plan or design',
    icon: '🔥',
    command: '/grill',
  },
  mermaid_graphs: {
    name: 'Diagrams',
    description: 'Generate Mermaid diagrams for visual explanations',
    icon: '📊',
    command: '/diagram',
  },
  checkin: {
    name: 'Check-in',
    description: 'Gentle daily mood, energy, and reflection check-in',
    icon: '💬',
    command: '/checkin',
  },
};

/** Maps slash commands to their skill ID. */
export const SKILL_COMMANDS: Record<string, SkillId> = {
  '/brainstorm': 'brainstorming',
  '/grill': 'grill_me',
  '/diagram': 'mermaid_graphs',
  '/checkin': 'checkin',
};

/** Commands that deactivate the current skill. */
export const DEACTIVATE_COMMANDS = ['/stop'] as const;

/**
 * Parses user input for skill slash commands.
 * Returns the action to take, or null if the input is not a command.
 */
export function isSkillCommand(
  input: string,
): { type: 'activate'; skillId: SkillId } | { type: 'deactivate' } | null {
  const trimmed = input.trim().toLowerCase();

  // Check deactivate first
  if (DEACTIVATE_COMMANDS.some((cmd) => trimmed === cmd || trimmed.startsWith(cmd + ' '))) {
    return { type: 'deactivate' };
  }

  // Check activate commands
  for (const [cmd, skillId] of Object.entries(SKILL_COMMANDS)) {
    if (trimmed === cmd || trimmed.startsWith(cmd + ' ')) {
      return { type: 'activate', skillId };
    }
  }

  return null;
}
