import { effectiveJudgeAssignments } from '@robinhacks/core';
import type {
  AwardResults,
  JudgeDecision,
  Team,
  CommunityBallot,
  CommunityCommand,
  CommandResult,
  JudgeAssignment,
  JudgingSheet,
  Member,
  MessageReport,
  PlatformSnapshot,
  ProjectSubmission,
  ProjectUpdate,
  TeamConversation,
  MessageRequest,
} from '@robinhacks/core';
import type { EventPaths } from '../paths';
import type { Transaction } from '../repository';
import type { CommandContext } from './context';
import { judgingReview } from './judging-review';
import { BallotService } from './ballot-service';
import { JudgingService } from './judging-service';
import { MessagingService } from './messaging-service';
import { GeneralChatService } from './general-chat-service';
import { ChatReviewService } from './chat-review-service';
import { Permissions } from './permissions';
import { PlatformPermissions } from './platform-permissions';
import { ProjectService } from './project-service';

type SnapshotContext = Pick<CommandContext, 'tx' | 'paths' | 'event' | 'member' | 'now'>;
type CommunitySnapshot = Omit<PlatformSnapshot, 'rounds' | 'allocation' | 'entitlements'>;

/** Application facade for team evidence, private conversations and independent awards. */
export class CommunityService {
  private readonly projects = new ProjectService();
  private readonly messaging = new MessagingService();
  private readonly general = new GeneralChatService();
  private readonly review = new ChatReviewService();
  private readonly judging = new JudgingService();
  private readonly ballots = new BallotService();

  async execute(context: CommandContext, command: CommunityCommand): Promise<CommandResult> {
    Permissions.member(context.member);
    PlatformPermissions.config(context.event);
    switch (command.type) {
      case 'publishUpdate':
      case 'setSubmissionWindow':
      case 'submitProject':
        return this.projects.execute(context, command);
      case 'sendGeneralMessage':
      case 'readGeneral':
        return this.general.execute(context, command);
      case 'removeChatMessage':
        return this.review.remove(context, command);
      case 'sendMessage':
      case 'readConversation':
      case 'blockConversation':
      case 'reportMessage':
        return this.messaging.execute(context, command);
      case 'setBallotWindow':
      case 'saveBallot':
        return this.ballots.execute(context, command);
      case 'submitJudgeDecision':
      case 'setPitchOrder':
      case 'setJudgingMode':
      case 'assignJudge':
      case 'saveJudgingSheet':
      case 'beginJudging':
      case 'prepareAwards':
      case 'discardAwards':
      case 'publishAwards':
        return this.judging.execute(context, command);
    }
  }

  readConversation(
    tx: Transaction,
    paths: EventPaths,
    member: Member,
    otherTeamId: string,
  ): Promise<TeamConversation | null> {
    return this.messaging.readConversation(tx, paths, member, otherTeamId);
  }

  generalSummary(tx: Transaction, paths: EventPaths, member: Member) {
    return this.general.summary(tx, paths, member);
  }

  messages(tx: Transaction, paths: EventPaths, member: Member, request: MessageRequest) {
    Permissions.member(member);
    if (request.kind === 'general') return this.general.page(tx, paths, member, request.before);
    if (request.kind === 'review')
      return this.review.page(tx, paths, member, request.id!, request.before);
    return this.messaging.page(tx, paths, member, request.id!, request.before);
  }

  conversationDirectory(tx: Transaction, paths: EventPaths, member: Member) {
    Permissions.member(member);
    return this.review.directory(tx, paths, member);
  }

  async snapshot({ tx, paths, event, member }: SnapshotContext): Promise<CommunitySnapshot> {
    Permissions.member(member);
    PlatformPermissions.config(event);
    const organizer = member.role === 'organizer' && member.teamId === null;
    const judge = member.role === 'judge' && member.teamId === null;
    const competitor = !!member.teamId && !['organizer', 'judge'].includes(member.role);
    const [
      updates,
      submissions,
      members,
      conversations,
      general,
      reports,
      storedAssignments,
      judgingSheets,
      ballot,
      awards,
    ] = await Promise.all([
      tx.list<ProjectUpdate>(paths.collection('projectUpdates'), 301),
      tx.list<ProjectSubmission>(paths.collection('submissions'), 31),
      tx.list<Member>(paths.collection('members'), 501),
      competitor ? this.messaging.inbox(tx, paths, member) : Promise.resolve([]),
      this.general.summary(tx, paths, member),
      organizer
        ? tx.list<MessageReport>(paths.collection('messageReports'), 101)
        : Promise.resolve([]),
      organizer || judge
        ? tx.list<JudgeAssignment>(paths.collection('judgeAssignments'), 51)
        : Promise.resolve([]),
      organizer || judge
        ? tx.list<JudgingSheet>(paths.collection('judgingSheets'), 51)
        : Promise.resolve([]),
      competitor
        ? tx.get<CommunityBallot>(paths.doc('communityBallots', member.teamId!))
        : Promise.resolve(null),
      tx.get<AwardResults>(paths.doc('awardResults', 'current')),
    ]);
    const teams = organizer || judge ? await tx.list<Team>(paths.collection('teams'), 31) : [];
    const mode = event.platform!.judgingMode ?? 'all';
    const assignments = effectiveJudgeAssignments(
      mode,
      members,
      teams,
      submissions,
      storedAssignments,
    );
    const review =
      organizer || judge
        ? judgingReview(
            teams,
            submissions,
            members,
            assignments,
            judgingSheets,
            event.platform!.funding,
            mode,
          )
        : null;
    const decision =
      organizer || judge
        ? await tx.get<JudgeDecision>(paths.doc('judgeDecisions', 'current'))
        : null;
    return {
      judgeDecision:
        decision &&
        review?.ready &&
        decision.evidenceKey === review.evidenceKey &&
        review.activeJudgeIds.includes(decision.submittedBy)
          ? decision
          : null,
      deliberationReady: review?.ready ?? false,
      deliberationJudgeIds: review?.activeJudgeIds ?? [],
      updates: updates.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)),
      submissions,
      roster: members
        .filter(
          (candidate) =>
            candidate.status === 'approved' &&
            candidate.teamId !== null &&
            !['organizer', 'judge'].includes(candidate.role),
        )
        .map((candidate) => ({
          uid: candidate.uid,
          name: candidate.displayName,
          teamId: candidate.teamId!,
          role: candidate.role,
          ...(candidate.bio ? { bio: candidate.bio } : {}),
        })),
      conversations,
      general,
      reports,
      assignments:
        organizer || judge ? (mode === 'assigned' ? storedAssignments : assignments) : [],
      judgingSheets: organizer
        ? judgingSheets
        : judgingSheets.filter(
            (sheet) =>
              sheet.uid === member.uid ||
              (review?.ready &&
                sheet.submittedAt !== null &&
                review.activeJudgeIds.includes(sheet.uid)),
          ),
      ballot,
      awards: organizer || awards?.publishedAt != null ? awards : null,
    };
  }
}
