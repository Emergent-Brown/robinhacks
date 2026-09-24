import type {
  AwardResults,
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
} from '@robinhacks/core';
import type { EventPaths } from '../paths';
import type { Transaction } from '../repository';
import type { CommandContext } from './context';
import { BallotService } from './ballot-service';
import { JudgingService } from './judging-service';
import { MessagingService } from './messaging-service';
import { Permissions } from './permissions';
import { PlatformPermissions } from './platform-permissions';
import { ProjectService } from './project-service';

type SnapshotContext = Pick<CommandContext, 'tx' | 'paths' | 'event' | 'member' | 'now'>;
type CommunitySnapshot = Omit<PlatformSnapshot, 'rounds' | 'allocation' | 'entitlements'>;

/** Application facade for team evidence, private conversations and independent awards. */
export class CommunityService {
  private readonly projects = new ProjectService();
  private readonly messaging = new MessagingService();
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
      case 'sendMessage':
      case 'readConversation':
      case 'blockConversation':
      case 'reportMessage':
        return this.messaging.execute(context, command);
      case 'setBallotWindow':
      case 'saveBallot':
        return this.ballots.execute(context, command);
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
      reports,
      assignments,
      judgingSheets,
      ballot,
      awards,
    ] = await Promise.all([
      tx.list<ProjectUpdate>(paths.collection('projectUpdates'), 301),
      tx.list<ProjectSubmission>(paths.collection('submissions'), 31),
      tx.list<Member>(paths.collection('members'), 501),
      competitor ? this.messaging.inbox(tx, paths, member) : Promise.resolve([]),
      organizer
        ? tx.list<MessageReport>(paths.collection('messageReports'), 101)
        : Promise.resolve([]),
      organizer
        ? tx.list<JudgeAssignment>(paths.collection('judgeAssignments'), 51)
        : judge
          ? tx
              .get<JudgeAssignment>(paths.doc('judgeAssignments', member.uid))
              .then((assignment) => (assignment ? [assignment] : []))
          : Promise.resolve([]),
      organizer
        ? tx.list<JudgingSheet>(paths.collection('judgingSheets'), 51)
        : judge
          ? tx
              .get<JudgingSheet>(paths.doc('judgingSheets', member.uid))
              .then((sheet) => (sheet ? [sheet] : []))
          : Promise.resolve([]),
      competitor
        ? tx.get<CommunityBallot>(paths.doc('communityBallots', member.teamId!))
        : Promise.resolve(null),
      tx.get<AwardResults>(paths.doc('awardResults', 'current')),
    ]);
    const assignedIds = new Set(assignments.flatMap((assignment) => assignment.projectIds));
    return {
      updates: updates.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)),
      submissions: judge
        ? submissions.filter((submission) => assignedIds.has(submission.teamId))
        : submissions,
      roster: members
        .filter(
          (candidate) =>
            candidate.status === 'approved' &&
            candidate.teamId !== null &&
            !['organizer', 'judge'].includes(candidate.role) &&
            (!judge || assignedIds.has(candidate.teamId)),
        )
        .map((candidate) => ({
          uid: candidate.uid,
          name: candidate.displayName,
          teamId: candidate.teamId!,
          role: candidate.role,
          ...(candidate.bio ? { bio: candidate.bio } : {}),
        })),
      conversations,
      reports,
      assignments,
      judgingSheets,
      ballot,
      awards: organizer || awards?.publishedAt != null ? awards : null,
    };
  }
}
