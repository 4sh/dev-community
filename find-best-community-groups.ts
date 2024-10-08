/// <reference path="find-best-community-groups.d.ts" />

import * as fs from 'node:fs'
import fisherYatesShuffle from 'fisher-yates'
import playerFactory from 'play-sound'
import {match, P} from "ts-pattern";

const player = playerFactory({});

const COMMUNITY_DESCRIPTOR_INPUT_FILE = './community-descriptor.json'
const MEMBERS_FILE = './members.json'
const BEST_RESULT_OUTPUT_FILE = './best-result.json'

const args = process.argv.slice(2);

const params = match(args)
  .with(['show'], () => ({
    command: 'show'
  } as const))
  .with(['compute', P.string], (args) => ({
    command: 'compute',
    trackName: args[1]
  } as const))
  .with(['compute-single-groups'], (args) => ({
    command: 'compute-single-groups',
  } as const))
  .with(['record-member-groups'], (args) => ({
    command: 'record-member-groups'
  } as const))
  .otherwise(() => { throw new Error(`Usage:
- npm run find-best-community-groups compute <trackName>
- npm run find-best-community-groups compute-single-groups
- npm run find-best-community-groups show
- npm run find-best-community-groups record-member-groups
    `); })

console.info(`args: ${JSON.stringify(args)}`)

function loadBestResultFromFile(): Result|undefined {
  try {
    const result: Result = JSON.parse(fs.readFileSync(BEST_RESULT_OUTPUT_FILE, "utf-8"));
    return result;
  } catch(e) { return undefined; }
}
function loadBestTrackResultFromFile(track: TrackDescriptor): TrackResult|undefined {
  const result: Result = loadBestResultFromFile();
  if(!result) {
    return undefined;
  }

  return result.trackResults.find(tr => tr.track.name === track.name);
}

type ShuffleResult = {footprint: string, assignedMembers: CommunityMemberWithAssignedGroupName[] };
class TrackMemberShuffler {
    private readonly devs: CommunityMember[];
    private readonly techleads: CommunityMember[];

    private readonly devIndexes: number[];
    private readonly devHashes: number[];
    private readonly techleadIndexes: number[];
    private readonly techleadHashes: number[];

    private readonly perProjectDevs = new Map<string, CommunityMember[]>();
    private readonly perProjectTechleads = new Map<string, CommunityMember[]>();

    constructor(readonly track: TrackDescriptor) {
        this.devs = this.track.subscribers.filter(m => m.type === 'DEV');
        this.techleads = this.track.subscribers.filter(m => m.type === 'TECHLEAD');

        const typeIndexes = Array.from(new Set(this.track.subscribers.map(m => m.type)))
        const projectIndexes = Array.from(new Set(this.track.subscribers.map(m => m.mainProject)))
        const yearsIndexes = Array.from(new Set(this.track.subscribers.map(m => m.proStart)))

        const indexExtractor = (_, idx) => idx,
            hashExtractor = (m: CommunityMember) => {
                return yearsIndexes.indexOf(m.proStart) << 7 // Let's dedicate 2^(7-2)=32 slots for project indexes
                    | projectIndexes.indexOf(m.mainProject) << 2 // Let's dedicate 2^(2-0) slots for type indexes
                    | typeIndexes.indexOf(m.type);
            };

        this.devIndexes = this.devs.map(indexExtractor);
        this.devHashes = this.devs.map(hashExtractor);
        this.techleadIndexes = this.techleads.map(indexExtractor);
        this.techleadHashes = this.techleads.map(hashExtractor);

        projectIndexes.forEach(project => {
            this.perProjectDevs.set(project, this.track.subscribers.filter(m => m.type === 'DEV' && m.mainProject === project))
            this.perProjectTechleads.set(project, this.track.subscribers.filter(m => m.type === 'TECHLEAD' && m.mainProject === project))
        })
    }

    // BEWARE: this method needs to be as fast as possible (as this is going to be called *a lot*)
    public shuffle(): ShuffleResult {
        // cloning maps (and underlying arrays)
        const perProjectDevs = new Map(Array.from(this.perProjectDevs.entries(), ([key, value]) => [key, Array.from(value)]))
        const perProjectTechleads = new Map(Array.from(this.perProjectTechleads.entries(), ([key, value]) => [key, Array.from(value)]))

        // cloning arrays
        const shuffledDevIndexes: typeof this.devIndexes = fisherYatesShuffle(this.devIndexes.slice(0)),
              shuffledTechleadIndexes: typeof this.techleadIndexes = fisherYatesShuffle(this.techleadIndexes.slice(0));

        const { assignedMembers, footprintChunks } = this.track.groups.reduce((result, group, groupIdx) => {
            const groupPerProjectMembers = {};
            const groupFootprintChunks = [];

            let animatorType: CommunityMember['type'] | "NONE";
            if(group.animator) {
              const animator = this.track.subscribers.find(sub => sub.trigram === group.animator);
              result.assignedMembers.push({
                ...animator,
                group: group.name
              })

              const animatorProjectMembers = (animator.type==='DEV'?perProjectDevs:perProjectTechleads).get(animator.mainProject)
              animatorProjectMembers.splice(animatorProjectMembers.findIndex(m => m.trigram === animator.trigram), 1);
              groupPerProjectMembers[animator.mainProject] = [ animator ];

              if(animator.type === 'DEV') {
                const animatorDevIndex = this.devs.findIndex(member => member.trigram === animator.trigram);
                shuffledDevIndexes.splice(shuffledDevIndexes.findIndex(idx => idx === animatorDevIndex), 1)
              } else if(animator.type === 'TECHLEAD') {
                const animatorTLIndex = this.techleads.findIndex(member => member.trigram === animator.trigram);
                shuffledTechleadIndexes.splice(shuffledTechleadIndexes.findIndex(idx => idx === animatorTLIndex), 1)
              }

              animatorType = animator.type;
            } else {
              animatorType = 'NONE';
            }

            for(let i=0; i<group.techleadsCount - (animatorType === 'TECHLEAD'?1:0); i++) {
                const tcIndex = shuffledTechleadIndexes.shift();
                const techlead = this.techleads[tcIndex];
                result.assignedMembers.push({
                  ...techlead,
                  group: group.name
                })
                groupFootprintChunks.push(this.techleadHashes[tcIndex])
            }

            for(let i=0; i<group.devsCount - (animatorType === 'DEV'?1:0); i++) {
                const devIndex = shuffledDevIndexes.shift();
                const dev = this.devs[devIndex];
                result.assignedMembers.push({
                  ...dev,
                  group: group.name
                })
                groupFootprintChunks.push(this.devHashes[devIndex])
            }

            // Important part, here, is the sort() at group level, considering that permutations (within the group)
            // should lead to the same footprint
            Array.prototype.push.apply(result.footprintChunks, groupFootprintChunks.sort());

            return result;
        }, { assignedMembers: [], footprintChunks: [] } as { assignedMembers: CommunityMemberWithAssignedGroupName[], footprintChunks: number[] })

        return { assignedMembers, footprint: footprintChunks.join(',') };
    }
}

async function bestShuffleFor(communityDescriptor: CommunityDescriptor, track: TrackDescriptor): Promise<TrackResult> {
    let bestResult: TrackResult = {track, members: [], score: {score: Infinity, groupsScores:[], duplicatedPathsMalus: 0, duplicatedPaths: [], xpStdDev: 0}};

    const { subscribers: members, groups } = track;

    const INITIAL_RESULT = loadBestTrackResultFromFile(track);

    const initialMembers = INITIAL_RESULT?.members;
    if(initialMembers) {
        const devIdentity = (m: CommunityMember) =>
            `${m.type}_${m.trigram}_${m.mainProject}_${m.proStart}`

        let initialHash = initialMembers.map(devIdentity).sort();
        let actualHash = members.map(devIdentity).sort();
        if(initialHash.join(",") !== actualHash.join(",")) {
            console.error(`It seems like there is a remaining ${BEST_RESULT_OUTPUT_FILE} file (not matching actual members descriptor): shouldn't you delete it ?`)
            console.info(``)
            console.info(`Actual members descriptor: ${JSON.stringify(actualHash)}`)
            console.info(`Expected members descriptor: ${JSON.stringify(initialHash)}`)
            return;
        }
    }

    const shuffler = new TrackMemberShuffler(track);

    let lastIndex = 0, lastTS = Date.now(), idx = 0, attemptsMatchingConstraints = 0, lastAttemptsMatchingConstraints = 0;
    let shuffResult: ShuffleResult;
    const alreadyProcessedFootprints = new Set<string>();
    while(shuffResult = shuffler.shuffle()) {
        const {assignedMembers, footprint} = shuffResult;

        if(initialMembers && idx===0) {
            assignedMembers.length = 0;
            Array.prototype.push.apply(assignedMembers, members.map(m => {
                const initialMember = initialMembers.find(initialMember => initialMember.trigram === m.trigram)
                return ({...m, group: initialMember.group });
            }))
        }

        if(!alreadyProcessedFootprints.has(footprint)) {
            alreadyProcessedFootprints.add(footprint);
            if(shuffledDevsMatchesConstraint(assignedMembers, groups, communityDescriptor.maxSameProjectPerGroup, communityDescriptor.maxMembersPerGroupWithDuplicatedProject)) {
                attemptsMatchingConstraints++;

                const score = scoreOf(assignedMembers, groups, communityDescriptor);
                const result: TrackResult = { track, score, members: assignedMembers };
                if(bestResult.score.score > score.score) {
                    bestResult = result;
                    console.log(`[${idx}] Found new matching result with score of ${bestResult.score.score} !`)
                    onTrackResultFound(bestResult, communityDescriptor);
                } else {
                    // console.log(`[${idx}] Found new matching result, but not beating actual score...`)
                }
            }
        } else {
        //     console.log(`skipped (footprint already processed !)`)
        }

        idx++;

        if(idx % 1000000 === 0) {
            const currentTS = Date.now();
            const attempsPerSecond = Math.round((idx-lastIndex)*1000/(currentTS-lastTS));
            const attempsMatchingConstraintsPerSecond = Math.round((attemptsMatchingConstraints-lastAttemptsMatchingConstraints)*1000/(currentTS-lastTS));

            console.log(`[${new Date(currentTS).toISOString()}] [${idx}] ${currentTS-lastTS}ms elapsed => ${attempsPerSecond} attempts/sec, ${attempsMatchingConstraintsPerSecond} matching attempts/sec`)
            lastIndex = idx; lastTS = currentTS; lastAttemptsMatchingConstraints = attemptsMatchingConstraints;
        }

        if(track.groups.length === 1) {
          // no need to infinitely look for better options when there is only 1 group for the track
          break;
        }
    }

    return Promise.resolve(bestResult);
}


async function shuffleGroupsFor(communityDescriptor: CommunityDescriptor, trackDescriptor: TrackDescriptor) {
    const result = await bestShuffleFor(communityDescriptor, trackDescriptor);
    if(!result) {
        return ["Nothing found matching constraints !"];
    }

    onTrackResultFound(result, communityDescriptor);
}

function showTrackResult(trackResult: TrackResult, referenceYearForSeniority: number) {
  console.log(`Group assignments:`)
  trackResult.score.groupsScores.forEach((groupScore, idx) => {
    const group = trackResult.track.groups.find(g => g.name === groupScore.name);
    const groupMembers = trackResult.members.filter(member => member.group === groupScore.name)
    console.log(`[${groupScore.name}] - avg_xp(dev)=${groupScore.groupAverageXP}, tot_xp(dev)=${groupScore.groupTotalXP}, count(dev)=${groupMembers.filter(m => m.type==='DEV').length}, count(tl)=${groupMembers.filter(m => m.type==='TECHLEAD').length}`)
    console.log(groupMembers
      .map(member => `${member.trigram === group.animator?'*':''}${member.firstName} ${member.lastName}${member.trigram === group.animator?'*':''}`)
      .join(", "))
    console.log(`\nDetails:`)
    console.log(groupMembers
      .map(member => `${member.trigram === group.animator?'*':''}${member.firstName} ${member.lastName}${member.trigram === group.animator?'*':''} (XP=${xpOf(member, referenceYearForSeniority)}, ${member.mainProject})`)
      .join(", "))
    console.log(``);
  })

  console.log(`Global score: ${trackResult.score.score}`)
  console.log(`Standard deviation on groups' avg_xp(dev) : ${trackResult.score.xpStdDev}`)
  console.log(`Duplicated paths malus : ${trackResult.score.duplicatedPathsMalus}`)
  if(trackResult.score.duplicatedPaths.length) {
    console.log(`Detailed duplicated paths : ${JSON.stringify(trackResult.score.duplicatedPaths)}`)
  }
  console.log('')

  trackResult.score.groupsScores.forEach((groupScore, idx) => {
    console.log(`${groupScore.name} same projects #: tot=${groupScore.sameProjectsCounts}`)
  })

  console.log('')
}

function onTrackResultFound(trackResult: TrackResult, communityDescriptor: CommunityDescriptor) {
    const result: Result = loadBestResultFromFile() || {trackResults: [], communityDescriptor}

    const trackResultIndex = result.trackResults.findIndex(tr => tr.track.name === trackResult.track.name);
    if(trackResultIndex === -1) {
      result.trackResults.push(trackResult);
    } else {
      result.trackResults[trackResultIndex] = trackResult;
    }

    fs.writeFileSync(BEST_RESULT_OUTPUT_FILE, JSON.stringify(result, null, '  '));

    showTrackResult(trackResult, communityDescriptor.referenceYearForSeniority);

    // Trying to play the sound ... and if it fails, never mind !
    try { player.play('mixkit-gaming-lock-2848.wav') }catch(e) {}
}

function stddev (array: number[]): number {
    const n = array.length;
    const mean = array.reduce((a, b) => a + b) / n;
    return Math.sqrt(array.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
}

function xpOf(member: CommunityMember, referenceYearForSeniority: number) {
    return referenceYearForSeniority - member.proStart;
}

function scoreOf(devs: CommunityMemberWithAssignedGroupName[], groups: CommunityGroup[], communityDescriptor: CommunityDescriptor): ResultDetailedScore {
    const result = groups.reduce((result, group) => {
        // only devs are counting in the score (tech lead XP is not taken into account)
        const groupXPs = devs.filter(d => d.group === group.name && d.type === 'DEV').map(d => xpOf(d, communityDescriptor.referenceYearForSeniority))
        const groupTotalXP = groupXPs.reduce((total, years) => total+years, 0);
        const groupAverageXP = Math.round(groupTotalXP*100 / groupXPs.length)/100;

        const groupMembers = devs.filter(d => d.group === group.name);
        groupMembers.forEach(m => {
            // Members having "empty" past group should be ignored
            const newConsecutiveGroups = [group.name].concat(m.latestGroups.slice(0, communityDescriptor.samePathSize-1))
            if(newConsecutiveGroups.findIndex(lg => lg === '') === -1) {
                const path = newConsecutiveGroups.join("|")
                if(result.alreadyEncounteredPaths.has(path)) {
                    const membersSharingSamePath = result.alreadyEncounteredPaths.get(path);
                    if(membersSharingSamePath.length === 1) {
                        result.samePaths.push({ path, firstName: membersSharingSamePath[0].firstName, lastName: membersSharingSamePath[0].lastName });
                    }
                    result.samePaths.push({ path, firstName: m.firstName, lastName: m.lastName });
                    membersSharingSamePath.push(m);
                } else {
                    result.alreadyEncounteredPaths.set(path, [m]);
                }
            }
        })

        const projects = groupMembers.map((d, idx) => d.mainProject==='*'?`_wildcarded_project_${result.wildcardProjectGeneratedIndex++}`:d.mainProject);
        const sameProjectsCounts = projects.length - new Set(projects).size;
        return {
            score: 0.0,
            groupsScores: result.groupsScores.concat([{ name: group.name, groupXPs, groupTotalXP, groupAverageXP, projects, sameProjectsCounts }]),
            alreadyEncounteredPaths: result.alreadyEncounteredPaths,
            samePaths: result.samePaths,
            wildcardProjectGeneratedIndex: result.wildcardProjectGeneratedIndex
        };
    }, { score: 0.0, groupsScores: [] as GroupScore[], alreadyEncounteredPaths: new Map<string, CommunityMemberWithAssignedGroupName[]>(), samePaths: [] as DuplicatedPath[], wildcardProjectGeneratedIndex: 0 });

    const xpStdDev = stddev(result.groupsScores.map(gs => gs.groupAverageXP * communityDescriptor.xpWeight));
    const duplicatedPaths = result.samePaths;
    const duplicatedPathsMalus = duplicatedPaths.length * communityDescriptor.malusPerSamePath;

    return {
        score: xpStdDev + duplicatedPathsMalus,
        xpStdDev,
        duplicatedPathsMalus,
        duplicatedPaths,
        groupsScores: result.groupsScores
    };
}

function shuffledDevsMatchesConstraint(devs: CommunityMemberWithAssignedGroupName[], groups: CommunityGroup[], maxSameProjectPerGroup: number, maxMembersPerGroupWithDuplicatedProject: number): boolean {
    // When we only have 1 group, we shouldn't try to look for permutations because we have no choices...
    if(groups.length === 1) {
      return true;
    }

    for(const group of groups) {
      const devsInGroup = devs.filter(d => d.group === group.name);
      const projects = devsInGroup
        .map((d, idx) => d.mainProject==='*'?'project '+idx:d.mainProject);

      const projectCounts = projects.reduce((projectCounts, project) => {
        projectCounts.set(project, (projectCounts.get(project) || 0)+1);
        return projectCounts;
      }, new Map<string, number>());

      // const membersHavingSameProjectCount = devsInGroup.length - projectCounts.size;
      const maxDuplicates: number = Math.max.apply(null, Array.from(projectCounts.values()))

      if(maxDuplicates > maxSameProjectPerGroup) {
        // console.warn(`Group ${group.name}: Max project duplicates (${maxSameProjectPerGroup}) overtaken (${maxDuplicates})`)
        return false;
      }
      if(devsInGroup.length - projectCounts.size > maxMembersPerGroupWithDuplicatedProject) {
        // console.warn(`Group ${group.name}: Max member with duplicated projects (${maxMembersPerGroupWithDuplicatedProject}) overtaken (${devsInGroup.length - projectCounts.size})`)
        return false;
      }
    }

    return true;
}

function trigramStrToArray(trigramsStr: string|null|undefined): string[] {
  if(!trigramsStr) {
    return [];
  }

  return trigramsStr.split(/[\t\s,]/gi).filter(val => !!val)
}

function resolveCommunityMembersFromTrigramsString(trigrams: string[], members: CommunityMember[], scope: string, unknownTrigrams: Array<{scope: string, trigram: string}>) {
  return trigrams.map(trigram => {
    const member = members.find(m => m.trigram === trigram);
    if(!member) {
      unknownTrigrams.push({ scope, trigram })
    }
    return member;
  })
}

function ensureValidCommunityDescriptor(members: Array<CommunityMember>, rawCommunityDescriptor: RawCommunityDescriptor): CommunityDescriptor {

  const tracksIncludingUnsubscribedMembers = rawCommunityDescriptor.tracks.filter(t => t.alsoIncludeUnsubscribedMembers);
  if(tracksIncludingUnsubscribedMembers.length > 1) {
    throw new Error(`More than 1 Track has [alsoIncludeUnsubscribedMembers] flag to true: ${tracksIncludingUnsubscribedMembers.map(t => t.name).join(", ")}`)
  }
  const tracksNotIncludingUnsubscribedMembers = rawCommunityDescriptor.tracks.filter(t => !t.alsoIncludeUnsubscribedMembers);

  if(rawCommunityDescriptor.absentsFromThisCycle) {
      const absentsFromThisCycleTrigrams = trigramStrToArray(rawCommunityDescriptor.absentsFromThisCycle);

      const absentTrigramsReferencedInTracks = rawCommunityDescriptor.tracks.reduce((absentTrigramsReferencedInTracks, track) => {
        const trackTrigrams = trigramStrToArray(track.subscribers);

        trackTrigrams.filter(trackTrigram => absentsFromThisCycleTrigrams.includes(trackTrigram))
          .forEach(referencedAbsentTrackTrigram => {
            absentTrigramsReferencedInTracks.push({
              absentTrigram: referencedAbsentTrackTrigram,
              referencedInTrack: track.name
            })
          })
        return absentTrigramsReferencedInTracks;
      }, [] as Array<{ absentTrigram: string, referencedInTrack: string }>)

      if(absentTrigramsReferencedInTracks.length) {
        throw new Error(`Following absent trigram have been referenced in tracks:
${absentTrigramsReferencedInTracks.map(atrit => `- ${atrit.absentTrigram} referenced in: ${atrit.referencedInTrack}`).join("\n")}`)
      }
  }

  const unknownTrigrams: Array<{ scope: string, trigram: string }> = []
  const absentsFromThisCycle = resolveCommunityMembersFromTrigramsString(
    trigramStrToArray(rawCommunityDescriptor.absentsFromThisCycle?.trim()), members,
    `global->absentsFromThisCycle`, unknownTrigrams);

  let trigramsNotAlreadyReferencedInTracks = members
    .filter(member => absentsFromThisCycle.findIndex(absentMember => absentMember.trigram === member.trigram) === -1)
    .map(m => m.trigram)

  const communityDescriptor: CommunityDescriptor = {
    ...rawCommunityDescriptor,
    absentsFromThisCycle,
    // Ending list of track by the ones including unsubscribed members, so that we can calculate remaining members
    // not assigned to other tracks
    tracks: tracksNotIncludingUnsubscribedMembers.concat(tracksIncludingUnsubscribedMembers).map(track => {
      const subscriberTrigrams = track.alsoIncludeUnsubscribedMembers
        ? trigramsNotAlreadyReferencedInTracks
        : trigramStrToArray(track.subscribers);

      track.groups.forEach(group => {
        if(group.animator && !subscriberTrigrams.includes(group.animator)) {
          unknownTrigrams.push({ scope: `${track.name}->${group.name}->animator`, trigram: group.animator })
        }
      })

      trigramsNotAlreadyReferencedInTracks = trigramsNotAlreadyReferencedInTracks.filter(t => !subscriberTrigrams.includes(t))

      const subscribers = resolveCommunityMembersFromTrigramsString(subscriberTrigrams, members, `${track.name}->subscribers`, unknownTrigrams);

      // For tracks with only 1 group, no need to provide devsCount and techLeadsCount constraints
      // as it will be auto-calculated
      if(track.groups.length === 1) {
        const uniqueTrackGroup = track.groups[0]
        uniqueTrackGroup.devsCount = uniqueTrackGroup.devsCount || subscribers.filter(member => member.type === 'DEV').length
        uniqueTrackGroup.techleadsCount = uniqueTrackGroup.techleadsCount || subscribers.filter(member => member.type === 'TECHLEAD').length
      }

      return { ...track, subscribers }
    })
  }

  if(trigramsNotAlreadyReferencedInTracks.length + unknownTrigrams.length > 0) {
    const errors = [] as string[];
    if(trigramsNotAlreadyReferencedInTracks.length) {
      errors.push(`Some trigrams have not been allocated to any tracks: ${trigramsNotAlreadyReferencedInTracks.join(", ")}`)
    }
    if(unknownTrigrams.length) {
      errors.push(`Unknown trigrams detected: ${unknownTrigrams.map(ut => `${ut.trigram} (in scope [${ut.scope}])`).join(", ")}`)
    }

    throw new Error(errors.join("\n"));
  }

  // Checking track group constraints
  const tracksNotMatchingConstraints = communityDescriptor.tracks.reduce((tracksNotMatchingConstraints, track) => {
    const expectedDevs = track.groups.reduce((total, group) => total + group.devsCount, 0);
    const expectedTechleads = track.groups.reduce((total, group) => total + group.techleadsCount, 0);

    const trackDevs = track.subscribers.filter(member => member.type === 'DEV')
    const trackTechleads = track.subscribers.filter(member => member.type === 'TECHLEAD')

    if(expectedDevs !== trackDevs.length || expectedTechleads !== trackTechleads.length) {
      tracksNotMatchingConstraints.push({
        trackName: track.name,
        expectations: { devsCount: expectedDevs, techleadsCount: expectedTechleads },
        actual: { devsCount: trackDevs.length, techleadsCount: trackTechleads.length }
      })
    }

    return tracksNotMatchingConstraints;
  }, [] as Array<{
    trackName: string,
    expectations: {devsCount: number, techleadsCount: number },
    actual: {devsCount: number, techleadsCount: number },
  }>)

  if(tracksNotMatchingConstraints.length) {
    throw new Error(`Found some track groups size inconsistencies: \n${tracksNotMatchingConstraints.map(tnmc =>
      `- ${tnmc.trackName}: ${JSON.stringify({ expectations: tnmc.expectations, actual: tnmc.actual })}`
    ).join("\n")}`)
  }

  return communityDescriptor;
}

function ensureValidMembers(members: Array<CommunityMember>): Array<CommunityMember> {
  const membersIndexedByTrigram = Array.from(members.reduce((trigramsCounts, member) => {
    trigramsCounts.set(member.trigram, (trigramsCounts.get(member.trigram) || []).concat(member));
    return trigramsCounts;
  }, new Map<string, Array<CommunityMember>>()).entries())

  const duplicatedTrigrams = membersIndexedByTrigram.filter(([trigram, members]) => members.length > 1)
  if(duplicatedTrigrams.length) {
    throw new Error(`Duplicated trigram detected: ${duplicatedTrigrams.map(([trigram, members]) => `${trigram} (${members.map(m => `${m.firstName} ${m.lastName}`).join(", ")})`).join(", ")}`)
  }

  return members;
}

function readMembers() {
  const rawMembers: CommunityMember[] = JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf-8'))
  return ensureValidMembers(rawMembers)
}

function readCommunityDescriptor(communityMembers: CommunityMember[]) {
  const rawCommunityDescriptor: RawCommunityDescriptor = JSON.parse(fs.readFileSync(COMMUNITY_DESCRIPTOR_INPUT_FILE, 'utf-8'))
  return ensureValidCommunityDescriptor(communityMembers, rawCommunityDescriptor)
}

async function computeSingleGroupTracks() {
  const members = readMembers();
  const communityDescriptor = readCommunityDescriptor(members);

  const singleGroupTracks = communityDescriptor.tracks.filter(t => t.groups.length === 1);

  for(const track of singleGroupTracks) {
    const results = await shuffleGroupsFor(communityDescriptor, track);
    console.log(results);
  }
}

async function computeTrack(trackName: string) {
    const members = readMembers();
    const communityDescriptor = readCommunityDescriptor(members);

    const track = communityDescriptor.tracks.find(t => t.name.toLowerCase() === trackName.toLowerCase());
    if(!track) {
      throw new Error(`No track found matching name: ${trackName} (available tracks: ${communityDescriptor.tracks.map(t => t.name).join(", ")})`)
    }

    const results = await shuffleGroupsFor(communityDescriptor, track);
    console.log(results);
}

async function show() {
    const results = loadBestResultFromFile();
    results.trackResults.forEach(trackResult => {
      console.log(`******************`)
      console.log(`*** TRACK: ${trackResult.track.name}`)
      console.log(`******************`)

      showTrackResult(trackResult, results.communityDescriptor.referenceYearForSeniority);
    })

    // console.log("members (to import in google spreadsheet, through Actions > Import fill-groups JSON menu): ")
    // console.log(JSON.stringify(trackResult.members))
}

function recordMemberGroups() {
    const members = readMembers();
    const results = loadBestResultFromFile();

    const nonProcessedTrigrams = members.map(m => m.trigram)

    results.trackResults.forEach(trackResult => {
      trackResult.members.forEach(trackMember => {
        const member = members.find(m => m.trigram === trackMember.trigram)
        member.latestGroups.unshift(trackMember.group);
        nonProcessedTrigrams.splice(nonProcessedTrigrams.indexOf(member.trigram), 1);
      })
    })

    nonProcessedTrigrams.forEach(trigramUnallocatedToAnyGroup => {
      const member = members.find(m => m.trigram === trigramUnallocatedToAnyGroup)
      member.latestGroups.unshift("")
    })

    fs.writeFileSync(MEMBERS_FILE, JSON.stringify(members, null, '  '));
    console.log(`Updated ${members.length} members (${nonProcessedTrigrams.length} members are not attending this cycle's meetings)`)
}

match(params)
  .with({ command: 'compute'}, (params) => computeTrack(params.trackName))
  .with({ command: 'compute-single-groups'}, (params) => computeSingleGroupTracks())
  .with({ command: 'show'}, (params) => show())
  .with({ command: 'record-member-groups'}, (params) => recordMemberGroups())
  .exhaustive();
