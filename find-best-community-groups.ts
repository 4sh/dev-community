/// <reference path="find-best-community-groups.d.ts" />

import * as fs from 'node:fs'
import fisherYatesShuffle from 'fisher-yates'
import playerFactory from 'play-sound'

const player = playerFactory({});

const COMMUNITY_DESCRIPTOR_INPUT_FILE = './community-descriptor.json'
const MEMBERS_INPUT_FILE = './members.json'
const BEST_RESULT_OUTPUT_FILE = './best-result.json'

const args = process.argv.slice(2);

if(args.length !== 1) {
  throw new Error(`Usage: npm run find-best-community-groups <trackName>`)
}
const trackName = args[0];

console.info(`args: ${JSON.stringify(args)}`)

function loadBestResultFromFile(): Result|undefined {
  try {
    const result: Result = require(BEST_RESULT_OUTPUT_FILE);
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
                lastName: animator.lastName,
                firstName: animator.firstName,
                type: animator.type,
                trigram: animator.trigram,
                proStart: animator.proStart,
                mainProject: animator.mainProject,
                latestGroups: animator.latestGroups,
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
                    lastName: techlead.lastName,
                    firstName: techlead.firstName,
                    type: 'TECHLEAD',
                    trigram: techlead.trigram,
                    proStart: techlead.proStart,
                    mainProject: techlead.mainProject,
                    latestGroups: techlead.latestGroups,
                    group: group.name
                })
                groupFootprintChunks.push(this.techleadHashes[tcIndex])
            }

            for(let i=0; i<group.devsCount - (animatorType === 'DEV'?1:0); i++) {
                const devIndex = shuffledDevIndexes.shift();
                const dev = this.devs[devIndex];
                result.assignedMembers.push({
                    lastName: dev.lastName,
                    firstName: dev.firstName,
                    type: 'DEV',
                    trigram: dev.trigram,
                    proStart: dev.proStart,
                    mainProject: dev.mainProject,
                    latestGroups: dev.latestGroups,
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
    // const alreadyProcessedFootprints = new Set<string>();
    while(shuffResult = shuffler.shuffle()) {
        const {assignedMembers, footprint} = shuffResult;

        if(initialMembers && idx===0) {
            assignedMembers.length = 0;
            Array.prototype.push.apply(assignedMembers, members.map(m => {
                const initialMember = initialMembers.find(initialMember => initialMember.trigram === m.trigram)
                return ({...m, group: initialMember.group });
            }))
        }

        // if(!alreadyProcessedFootprints.has(footprint)) {
        //     alreadyProcessedFootprints.add(footprint);
            if(shuffledDevsMatchesConstraint(assignedMembers, groups, communityDescriptor.maxSameProjectPerGroup, communityDescriptor.maxMembersPerGroupWithDuplicatedProject)) {
                attemptsMatchingConstraints++;

                const score = scoreOf(assignedMembers, groups, communityDescriptor.referenceYearForSeniority, communityDescriptor.xpWeight, communityDescriptor.malusPerSamePath);
                const result: TrackResult = { track, score, members: assignedMembers };
                if(bestResult.score.score > score.score) {
                    bestResult = result;
                    console.log(`[${idx}] Found new matching result with score of ${bestResult.score.score} !`)
                    onTrackResultFound(bestResult, communityDescriptor);
                } else {
                    // console.log(`[${idx}] Found new matching result, but not beating actual score...`)
                }
            }
        // } else {
        //     console.log(`skipped (footprint already processed !)`)
        // }

        idx++;

        if(idx % 1000000 === 0) {
            const currentTS = Date.now();
            const attempsPerSecond = Math.round((idx-lastIndex)*1000/(currentTS-lastTS));
            const attempsMatchingConstraintsPerSecond = Math.round((attemptsMatchingConstraints-lastAttemptsMatchingConstraints)*1000/(currentTS-lastTS));

            console.log(`[${new Date(currentTS).toISOString()}] [${idx}] ${currentTS-lastTS}ms elapsed => ${attempsPerSecond} attempts/sec, ${attempsMatchingConstraintsPerSecond} matching attempts/sec`)
            lastIndex = idx; lastTS = currentTS; lastAttemptsMatchingConstraints = attemptsMatchingConstraints;
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

function onTrackResultFound(trackResult: TrackResult, communityDescriptor: CommunityDescriptor) {
    const result: Result = loadBestResultFromFile() || {trackResults: [], communityDescriptor}

    const trackResultIndex = result.trackResults.findIndex(tr => tr.track.name === trackResult.track.name);
    if(trackResultIndex === -1) {
      result.trackResults.push(trackResult);
    } else {
      result.trackResults[trackResultIndex] = trackResult;
    }

    fs.writeFileSync(BEST_RESULT_OUTPUT_FILE, JSON.stringify(result, null, '  '));

    console.log(`Group assignments:`)
    trackResult.score.groupsScores.forEach((groupScore, idx) => {
        const group = trackResult.track.groups.find(g => g.name === groupScore.name);
        const groupMembers = trackResult.members.filter(member => member.group === groupScore.name)
        console.log(`[${groupScore.name}] - avg_xp(dev)=${groupScore.groupAverageXP}, tot_xp(dev)=${groupScore.groupTotalXP}, count(dev)=${groupMembers.filter(m => m.type==='DEV').length}, count(tl)=${groupMembers.filter(m => m.type==='TECHLEAD').length}`)
        console.log(groupMembers
            .map(member => `${member.trigram === group.animator?'*':''}${member.firstName} ${member.lastName}${member.trigram === group.animator?'*':''} (XP=${xpOf(member, communityDescriptor.referenceYearForSeniority)}, ${member.mainProject})`)
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

    console.log("members (to import in google spreadsheet, through Actions > Import fill-groups JSON menu): ")
    console.log(JSON.stringify(trackResult.members))

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

function scoreOf(devs: CommunityMemberWithAssignedGroupName[], groups: CommunityGroup[], referenceYearForSeniority: number, xpWeight: number, malusPerSamePath: number): ResultDetailedScore {
    const result = groups.reduce((result, group) => {
        // only devs are counting in the score (tech lead XP is not taken into account)
        const groupXPs = devs.filter(d => d.group === group.name && d.type === 'DEV').map(d => xpOf(d, referenceYearForSeniority))
        const groupTotalXP = groupXPs.reduce((total, years) => total+years, 0);
        const groupAverageXP = Math.round(groupTotalXP*100 / groupXPs.length)/100;

        const groupMembers = devs.filter(d => d.group === group.name);
        groupMembers.forEach(m => {
            // Members having "empty" past group should be ignored
            const newConsecutiveGroups = m.latestGroups.slice(1).concat([group.name])
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
        const projects = groupMembers.map((d, idx) => d.mainProject==='*'?'project '+idx:d.mainProject);
        const sameProjectsCounts = projects.length - new Set(projects).size;
        return {
            score: 0.0,
            groupsScores: result.groupsScores.concat([{ name: group.name, groupXPs, groupTotalXP, groupAverageXP, projects, sameProjectsCounts }]),
            alreadyEncounteredPaths: result.alreadyEncounteredPaths,
            samePaths: result.samePaths
        };
    }, { score: 0.0, groupsScores: [], alreadyEncounteredPaths: new Map<string, CommunityMemberWithAssignedGroupName[]>(), samePaths: [] } as { score: number, groupsScores: GroupScore[], alreadyEncounteredPaths: Map<string, CommunityMemberWithAssignedGroupName[]>, samePaths: DuplicatedPath[] });

    const xpStdDev = stddev(result.groupsScores.map(gs => gs.groupAverageXP * xpWeight));
    const duplicatedPaths = result.samePaths;
    const duplicatedPathsMalus = duplicatedPaths.length * malusPerSamePath;

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

function ensureValidCommunityDescriptor(members: Array<CommunityMember>, rawCommunityDescriptor: RawCommunityDescriptor): CommunityDescriptor {

  const tracksIncludingUnsubscribedMembers = rawCommunityDescriptor.tracks.filter(t => t.alsoIncludeUnsubscribedMembers);
  if(tracksIncludingUnsubscribedMembers.length > 1) {
    throw new Error(`More than 1 Track has [alsoIncludeUnsubscribedMembers] flag to true: ${tracksIncludingUnsubscribedMembers.map(t => t.name).join(", ")}`)
  }

  const tracksNotIncludingUnsubscribedMembers = rawCommunityDescriptor.tracks.filter(t => !t.alsoIncludeUnsubscribedMembers);

  let trigramsNotAlreadyReferencedInTracks = members.map(m => m.trigram)
  const unknownTrigrams: Array<{ scope: string, trigram: string }> = []
  const communityDescriptor: CommunityDescriptor = {
    ...rawCommunityDescriptor,
    // Ending list of track by the ones including unsubscribed members, so that we can calculate remaining members
    // not assigned to other tracks
    tracks: tracksNotIncludingUnsubscribedMembers.concat(tracksIncludingUnsubscribedMembers).map(track => {
      const subscriberTrigrams = track.alsoIncludeUnsubscribedMembers
        ? trigramsNotAlreadyReferencedInTracks
        : track.subscribers.split(/[\t\s]/gi);

      track.groups.forEach(group => {
        if(group.animator && !subscriberTrigrams.includes(group.animator)) {
          unknownTrigrams.push({ scope: `${track.name}->${group.name}->animator`, trigram: group.animator })
        }
      })

      trigramsNotAlreadyReferencedInTracks = trigramsNotAlreadyReferencedInTracks.filter(t => !subscriberTrigrams.includes(t))

      return {
        ...track,
        subscribers: subscriberTrigrams.map(trigram => {
          const member = members.find(m => m.trigram === trigram);
          if(!member) {
            unknownTrigrams.push({ scope: `${track.name}->subscribers`, trigram })
          }
          return member;
        })
      }
    })
  }

  if(trigramsNotAlreadyReferencedInTracks.length) {
    throw new Error(`Some trigrams have not been allocated to any tracks: ${trigramsNotAlreadyReferencedInTracks.join(", ")}`)
  }
  if(unknownTrigrams.length) {
    throw new Error(`Unknown trigrams detected: ${unknownTrigrams.map(ut => `${ut.trigram} (in scope [${ut.scope}])`).join(", ")}`)
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

async function main(trackName: string) {
    const members = ensureValidMembers(require(MEMBERS_INPUT_FILE));
    const communityDescriptor = ensureValidCommunityDescriptor(members, require(COMMUNITY_DESCRIPTOR_INPUT_FILE));

    const track = communityDescriptor.tracks.find(t => t.name.toLowerCase() === trackName.toLowerCase());
    if(!track) {
      throw new Error(`No track found matching name: ${trackName} (available tracks: ${communityDescriptor.tracks.map(t => t.name).join(", ")})`)
    }

    const results = await shuffleGroupsFor(communityDescriptor, track);
    console.log(results);
}

main(trackName)
