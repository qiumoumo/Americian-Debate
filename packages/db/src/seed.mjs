import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { loadLocalEnv } from "./load-env.mjs";

loadLocalEnv();

const prisma = new PrismaClient();

// 开发用管理员账号（生产环境请通过 /register 自助注册或改用真实凭据）
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? "Owner";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const WORKSPACE_NAME = "Debate Workspace";

const sideMap = {
  Aff: "AFF",
  Neg: "NEG",
  Pro: "PRO",
  Con: "CON",
  Generic: "GENERIC"
};

const formatMap = {
  PF: "PF",
  LD: "LD",
  Policy: "POLICY",
  BP: "BP",
  Custom: "CUSTOM"
};

const resultMap = {
  win: "WIN",
  loss: "LOSS",
  pending: "PENDING"
};

const outcomeMap = {
  won: "WON",
  lost: "LOST",
  dropped: "DROPPED",
  turned: "TURNED",
  conceded: "CONCEDED"
};

const documents = [
  {
    id: "doc-immigration-econ",
    title: "Immigration Econ Core File",
    description: "Economic growth, labor supply, and local fiscal impact evidence.",
    evidence: [
      {
        id: "ev-labor-01",
        title: "Immigration expands labor supply",
        claim: "High-skill and low-skill immigration can raise productivity by complementing native workers.",
        quote: "Immigrant labor often complements rather than substitutes native labor, expanding output and specialization.",
        sourceUrl: "https://example.org/labor-supply",
        author: "National Academies",
        publication: "Economic Effects Report",
        publishedDate: "2025",
        side: "Aff",
        tags: ["economy", "labor", "growth"]
      },
      {
        id: "ev-fiscal-02",
        title: "Local fiscal stress answers",
        claim: "Fiscal impacts vary by jurisdiction and are strongest where integration funding is absent.",
        quote: "Short-run costs concentrate locally, but long-run tax contributions rise with labor-market integration.",
        sourceUrl: "https://example.org/fiscal-impact",
        author: "Urban Institute",
        publication: "Migration Policy Brief",
        publishedDate: "2026",
        side: "Neg",
        tags: ["fiscal", "local", "answers"]
      }
    ]
  },
  {
    id: "doc-ai-regulation",
    title: "AI Regulation Blocks",
    description: "Safety, innovation, compute governance, and international competition blocks.",
    evidence: [
      {
        id: "ev-safety-03",
        title: "Safety standards reduce catastrophic risk",
        claim: "Mandatory evaluations create common baselines without banning development.",
        quote: "Evaluation regimes can reveal dangerous capabilities before public deployment.",
        sourceUrl: "https://example.org/ai-safety-evals",
        author: "Frontier Safety Forum",
        publication: "AI Governance Note",
        publishedDate: "2026",
        side: "Aff",
        tags: ["ai", "safety", "standards"]
      }
    ]
  }
];

const matches = [
  {
    id: "match-1",
    tournament: "Local Scrimmage",
    opponent: "Northview AB",
    topic: "Immigration and labor markets",
    format: "PF",
    side: "Aff",
    result: "win",
    tags: ["economy", "weighing"],
    reflection: "We won on comparative labor market weighing, but summary needed cleaner collapse.",
    argumentOutcomes: [
      { argument: "Labor complementarity", side: "Aff", outcome: "won" },
      { argument: "Fiscal stress", side: "Neg", outcome: "lost" }
    ]
  },
  {
    id: "match-2",
    tournament: "Practice Round",
    opponent: "East Prep",
    topic: "AI regulation",
    format: "LD",
    side: "Neg",
    result: "loss",
    tags: ["ai", "framework"],
    reflection: "Dropped their standards overview; need a clearer pre-written framework block.",
    argumentOutcomes: [
      { argument: "Innovation tradeoff", side: "Neg", outcome: "dropped" },
      { argument: "Safety standards", side: "Aff", outcome: "won" }
    ]
  }
];

const speechTemplates = [
  { speech: "Constructive", focus: "Read case and establish weighing.", order: 1, durationMs: 240000 },
  { speech: "Rebuttal", focus: "Frontline turns and answer their offense.", order: 2, durationMs: 240000 },
  { speech: "Summary", focus: "Collapse to the cleanest offense and rebuild weighing.", order: 3, durationMs: 180000 },
  { speech: "Final Focus", focus: "Compare worlds and crystallize ballot story.", order: 4, durationMs: 120000 }
];

const practiceSessions = [
  {
    id: "practice-1",
    topic: "AI safety regulation",
    format: "LD",
    side: "Neg",
    transcriptJson: [
      { role: "user", content: "Regulation slows innovation and gives adversaries room to catch up." },
      { role: "assistant", content: "Answer with a comparative safety standard and weigh catastrophic risk against speed." }
    ],
    scoreJson: { score: 82, feedback: "Good clash on standards. Add clearer weighing before the last rebuttal." }
  },
  {
    id: "practice-2",
    topic: "Immigration economics",
    format: "PF",
    side: "Aff",
    transcriptJson: [
      { role: "user", content: "Immigration complements labor markets and raises specialization." },
      { role: "assistant", content: "Now compare your link chain against local fiscal stress." }
    ],
    scoreJson: { score: 76, feedback: "Evidence use was strong, but final focus repeated rather than compared." }
  }
];

const libraryRounds = [
  {
    id: "round-toc-pf-final",
    title: "2024 TOC PF Final",
    description: "教科书级的 summary collapse 与 final focus 权衡。",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    topic: "US–China trade policy",
    format: "PF",
    teams: "Team A vs Team B",
    year: "2024",
    tournament: "Tournament of Champions",
    tags: ["PF", "weighing", "final focus"]
  },
  {
    id: "round-nsda-ld-semis",
    title: "NSDA Nationals LD Semifinal",
    description: "framework 层的 clash 打得很干净，适合看 value/criterion 辩论。",
    videoUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
    topic: "Wealth redistribution",
    format: "LD",
    teams: "Aff vs Neg",
    year: "2025",
    tournament: "NSDA Nationals",
    tags: ["LD", "framework", "clash"]
  }
];

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env.local before running the seed script.");
  }
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const user = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { name: ADMIN_NAME, passwordHash },
    create: { email: ADMIN_EMAIL, name: ADMIN_NAME, passwordHash }
  });

  const workspace = await prisma.workspace.upsert({
    where: { id: "workspace-praiseforchaos" },
    update: { name: WORKSPACE_NAME, deletedAt: null },
    create: { id: "workspace-praiseforchaos", name: WORKSPACE_NAME }
  });

  await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: { role: "OWNER" },
    create: { userId: user.id, workspaceId: workspace.id, role: "OWNER" }
  });

  for (const document of documents) {
    await prisma.document.upsert({
      where: { id: document.id },
      update: {
        title: document.title,
        description: document.description,
        deletedAt: null
      },
      create: {
        id: document.id,
        workspaceId: workspace.id,
        ownerId: user.id,
        title: document.title,
        description: document.description,
        contentJson: { type: "doc", content: [] }
      }
    });

    for (const evidence of document.evidence) {
      await prisma.evidence.upsert({
        where: { id: evidence.id },
        update: {
          title: evidence.title,
          claim: evidence.claim,
          quote: evidence.quote,
          sourceUrl: evidence.sourceUrl,
          author: evidence.author,
          publication: evidence.publication,
          publishedDate: evidence.publishedDate,
          side: sideMap[evidence.side],
          tagsJson: evidence.tags,
          contentRange: {}
        },
        create: {
          id: evidence.id,
          documentId: document.id,
          title: evidence.title,
          claim: evidence.claim,
          quote: evidence.quote,
          sourceUrl: evidence.sourceUrl,
          author: evidence.author,
          publication: evidence.publication,
          publishedDate: evidence.publishedDate,
          side: sideMap[evidence.side],
          tagsJson: evidence.tags,
          contentRange: {}
        }
      });
    }
  }

  for (const match of matches) {
    await prisma.match.upsert({
      where: { id: match.id },
      update: {
        tournament: match.tournament,
        opponent: match.opponent,
        topic: match.topic,
        format: formatMap[match.format],
        side: sideMap[match.side],
        result: resultMap[match.result],
        tagsJson: match.tags,
        deletedAt: null
      },
      create: {
        id: match.id,
        workspaceId: workspace.id,
        userId: user.id,
        tournament: match.tournament,
        opponent: match.opponent,
        topic: match.topic,
        format: formatMap[match.format],
        side: sideMap[match.side],
        result: resultMap[match.result],
        tagsJson: match.tags
      }
    });

    await prisma.reflection.upsert({
      where: { matchId: match.id },
      update: { whatWorked: match.reflection },
      create: { matchId: match.id, whatWorked: match.reflection }
    });

    for (const template of speechTemplates) {
      const id = `${match.id}-${template.order}`;
      await prisma.speechNote.upsert({
        where: { id },
        update: {
          speechType: template.speech,
          speechOrder: template.order,
          timerDurationMs: template.durationMs
        },
        create: {
          id,
          matchId: match.id,
          speakerSide: sideMap[match.side],
          speechType: template.speech,
          speechOrder: template.order,
          notes: template.focus,
          timerDurationMs: template.durationMs
        }
      });
    }

    await prisma.argumentOutcome.deleteMany({ where: { matchId: match.id } });
    for (const outcome of match.argumentOutcomes) {
      await prisma.argumentOutcome.create({
        data: {
          matchId: match.id,
          argument: outcome.argument,
          side: sideMap[outcome.side],
          outcome: outcomeMap[outcome.outcome]
        }
      });
    }
  }

  for (const practice of practiceSessions) {
    await prisma.practiceSession.upsert({
      where: { id: practice.id },
      update: {
        workspaceId: workspace.id,
        topic: practice.topic,
        format: formatMap[practice.format],
        side: sideMap[practice.side],
        mode: "text-spar",
        aiProvider: "mock",
        rubricJson: ["clash", "evidence extension", "weighing", "strategic collapse"],
        transcriptJson: practice.transcriptJson,
        scoreJson: practice.scoreJson
      },
      create: {
        id: practice.id,
        userId: user.id,
        workspaceId: workspace.id,
        topic: practice.topic,
        format: formatMap[practice.format],
        side: sideMap[practice.side],
        mode: "text-spar",
        aiProvider: "mock",
        rubricJson: ["clash", "evidence extension", "weighing", "strategic collapse"],
        transcriptJson: practice.transcriptJson,
        scoreJson: practice.scoreJson
      }
    });
  }

  for (const round of libraryRounds) {
    await prisma.libraryRound.upsert({
      where: { id: round.id },
      update: {
        title: round.title,
        description: round.description,
        videoUrl: round.videoUrl,
        topic: round.topic,
        format: formatMap[round.format],
        teams: round.teams,
        year: round.year,
        tournament: round.tournament,
        tagsJson: round.tags,
        deletedAt: null
      },
      create: {
        id: round.id,
        workspaceId: workspace.id,
        createdByUserId: user.id,
        title: round.title,
        description: round.description,
        videoUrl: round.videoUrl,
        topic: round.topic,
        format: formatMap[round.format],
        teams: round.teams,
        year: round.year,
        tournament: round.tournament,
        tagsJson: round.tags
      }
    });
  }

  console.log(`Seeded workspace ${workspace.name}`);
  console.log(`Admin account: ${ADMIN_EMAIL}`);
  console.log("Role: OWNER (可用于用户端 /login 与管理端 /admin/login)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
