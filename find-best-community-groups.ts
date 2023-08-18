/// <reference path="find-best-community-groups.d.ts" />

import * as fs from 'node:fs'
import fisherYatesShuffle from 'fisher-yates'
import playerFactory from 'play-sound'

const player = playerFactory({});

const BEST_RESULT_FILE = './best-result.json'

function loadBestResultFile(): CommunityMemberWithAssignedGroupName[]|undefined {
    try { return require(BEST_RESULT_FILE).devs; }
    catch(e) { return undefined; }
}

type ShuffleResult = {footprint: string, assignedMembers: CommunityMemberWithAssignedGroupId[] };
class GroupMemberShuffler {
    private readonly animators: CommunityMember[];
    private readonly devs: CommunityMember[];
    private readonly techleads: CommunityMember[];

    private readonly animatorHashes: number[];
    private readonly devIndexes: number[];
    private readonly devHashes: number[];
    private readonly techleadIndexes: number[];
    private readonly techleadHashes: number[];

    private readonly perProjectDevs = new Map<string, CommunityMember[]>();
    private readonly perProjectTechleads = new Map<string, CommunityMember[]>();

    constructor(members: CommunityMember[], readonly groups: CommunityGroup[]) {
        this.animators = members.filter(m => m.isAnimator);
        if(this.animators.length !== groups.length) {
            throw new Error(`Number of animators ${this.animators.length} is different than the groups' size (${groups.length})`)
        }

        this.devs = members.filter(m => !m.isAnimator && m.type === 'DEV');
        this.techleads = members.filter(m => !m.isAnimator && m.type === 'TECHLEAD');

        const typeIndexes = Array.from(new Set(members.map(m => m.type)))
        const projectIndexes = Array.from(new Set(members.map(m => m.mainProject)))
        const yearsIndexes = Array.from(new Set(members.map(m => m.proStart)))

        const indexExtractor = (_, idx) => idx,
            hashExtractor = (m: CommunityMember) => {
                return yearsIndexes.indexOf(m.proStart) << 7 // Let's dedicate 2^(7-2)=32 slots for project indexes
                    | projectIndexes.indexOf(m.mainProject) << 2 // Let's dedicate 2^(2-0) slots for type indexes
                    | typeIndexes.indexOf(m.type);
            };

        this.animatorHashes = this.animators.map(hashExtractor);
        this.devIndexes = this.devs.map(indexExtractor);
        this.devHashes = this.devs.map(hashExtractor);
        this.techleadIndexes = this.techleads.map(indexExtractor);
        this.techleadHashes = this.techleads.map(hashExtractor);

        projectIndexes.forEach(project => {
            this.perProjectDevs.set(project, members.filter(m => m.type === 'DEV'))
            this.perProjectTechleads.set(project, members.filter(m => m.type === 'TECHLEAD'))
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

        const { assignedMembers, footprintChunks } = this.groups.reduce((result, group, groupIdx) => {
            const groupPerProjectMembers = {};
            const groupFootprintChunks = [];

            const animator = this.animators[groupIdx];
            result.assignedMembers.push({
                lastName: animator.lastName,
                firstName: animator.firstName,
                type: animator.type,
                email: animator.email,
                proStart: animator.proStart,
                isAnimator: true,
                mainProject: animator.mainProject,
                latestGroups: animator.latestGroups,
                group: groupIdx
            })
            groupFootprintChunks.push(this.animatorHashes[groupIdx])

            const animatorProjectMembers = (animator.type==='DEV'?perProjectDevs:perProjectTechleads).get(animator.mainProject)
            animatorProjectMembers.splice(animatorProjectMembers.findIndex(m => m.lastName === animator.lastName && m.firstName === animator.firstName), 1);
            groupPerProjectMembers[animator.mainProject] = [ animator ];

            for(let i=0; i<group.techleadsCount - (animator.type === 'TECHLEAD'?1:0); i++) {
                const tcIndex = shuffledTechleadIndexes.shift();
                const techlead = this.techleads[tcIndex];
                result.assignedMembers.push({
                    lastName: techlead.lastName,
                    firstName: techlead.firstName,
                    type: 'TECHLEAD',
                    email: techlead.email,
                    proStart: techlead.proStart,
                    isAnimator: false,
                    mainProject: techlead.mainProject,
                    latestGroups: techlead.latestGroups,
                    group: groupIdx
                })
                groupFootprintChunks.push(this.techleadHashes[tcIndex])
            }

            for(let i=0; i<group.devsCount - (animator.type === 'DEV'?1:0); i++) {
                const devIndex = shuffledDevIndexes.shift();
                const dev = this.devs[devIndex];
                result.assignedMembers.push({
                    lastName: dev.lastName,
                    firstName: dev.firstName,
                    type: 'DEV',
                    email: dev.email,
                    proStart: dev.proStart,
                    isAnimator: false,
                    mainProject: dev.mainProject,
                    latestGroups: dev.latestGroups,
                    group: groupIdx
                })
                groupFootprintChunks.push(this.devHashes[devIndex])
            }

            // Important part, here, is the sort() at group level, considering that permutations (within the group)
            // should lead to the same footprint
            Array.prototype.push.apply(result.footprintChunks, groupFootprintChunks.sort());

            return result;
        }, { assignedMembers: [], footprintChunks: [] } as { assignedMembers: CommunityMemberWithAssignedGroupId[], footprintChunks: number[] })

        return { assignedMembers, footprint: footprintChunks.join(',') };
    }
}

async function bestShuffleFor({devs, groups, referenceYearForSeniority, xpWeight, maxSameProjectPerGroup, maxMembersPerGroupWithDuplicatedProject, malusPerSamePath}: CommunityDescriptor): Promise<Result> {
    let bestResult: Result = {devs: [], score: {score: Infinity, groupsScores:[], duplicatedPathsMalus: 0, duplicatedPaths: [], xpStdDev: 0}};

    const INITIAL_MEMBERS_RESULT = loadBestResultFile();

    if(INITIAL_MEMBERS_RESULT) {
        const devIdentity = (m: CommunityMember) =>
            `${m.type}_${m.email}_${m.mainProject}_${m.isAnimator}_${m.proStart}`

        let initialHash = INITIAL_MEMBERS_RESULT.map(devIdentity).sort();
        let actualHash = devs.map(devIdentity).sort();
        if(initialHash.join(",") !== actualHash.join(",")) {
            console.error(`It seems like there is a remaining ${BEST_RESULT_FILE} file (not matching actual members descriptor): shouldn't you delete it ?`)
            console.info(``)
            console.info(`Actual members descriptor: ${JSON.stringify(actualHash)}`)
            console.info(`Expected members descriptor: ${JSON.stringify(initialHash)}`)
            return;
        }
    }

    const shuffler = new GroupMemberShuffler(devs, groups);

    let lastIndex = 0, lastTS = Date.now(), idx = 0, attemptsMatchingConstraints = 0, lastAttemptsMatchingConstraints = 0;
    let shuffResult: ShuffleResult;
    // const alreadyProcessedFootprints = new Set<string>();
    while(shuffResult = shuffler.shuffle()) {
        const {assignedMembers, footprint} = shuffResult;

        if(INITIAL_MEMBERS_RESULT && idx===0) {
            assignedMembers.length = 0;
            Array.prototype.push.apply(assignedMembers, devs.map(d => {
                const initialMember = INITIAL_MEMBERS_RESULT.find(m => m.firstName === d.firstName && m.lastName === d.lastName)
                return ({...d, group: groups.find(g => g.name === initialMember.group).id});
            }))
        }

        // if(!alreadyProcessedFootprints.has(footprint)) {
        //     alreadyProcessedFootprints.add(footprint);
            if(shuffledDevsMatchesConstraint(assignedMembers, groups, maxSameProjectPerGroup, maxMembersPerGroupWithDuplicatedProject)) {
                attemptsMatchingConstraints++;

                const score = scoreOf(assignedMembers, groups, referenceYearForSeniority, xpWeight, malusPerSamePath);
                const result: Result = { score, devs: assignedMembers.map(d => ({...d, group: groups.find(g => g.id === d.group).name })) };
                if(bestResult.score.score > score.score) {
                    bestResult = result;
                    console.log(`[${idx}] Found new matching result with score of ${bestResult.score.score} !`)
                    onResultFound(bestResult, referenceYearForSeniority);
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


async function shuffleGroupsFor(communityDescriptor: CommunityDescriptor) {
    const result = await bestShuffleFor(communityDescriptor);
    if(!result) {
        return ["Nothing found matching constraints !"];
    }

    onResultFound(result, communityDescriptor.referenceYearForSeniority);
}

function onResultFound(result: Result, referenceYearForSeniority: number) {
    fs.writeFileSync(BEST_RESULT_FILE, JSON.stringify(result, null, '  '));

    console.log(`Group assignments:`)
    result.score.groupsScores.forEach((groupScore, idx) => {
        const groupMembers = result.devs.filter(member => member.group === groupScore.name)
        console.log(`[${groupScore.name}] - avg_xp(dev)=${groupScore.groupAverageXP}, tot_xp(dev)=${groupScore.groupTotalXP}, count(dev)=${groupMembers.filter(m => m.type==='DEV').length}, count(tl)=${groupMembers.filter(m => m.type==='TECHLEAD').length}`)
        console.log(groupMembers
            .map(member => `${member.isAnimator?'*':''}${member.firstName} ${member.lastName}${member.isAnimator?'*':''} (XP=${xpOf(member, referenceYearForSeniority)}, ${member.mainProject})`)
            .join(", "))
        console.log(``);
    })

    console.log(`Global score: ${result.score.score}`)
    console.log(`Standard deviation on groups' avg_xp(dev) : ${result.score.xpStdDev}`)
    console.log(`Duplicated paths malus : ${result.score.duplicatedPathsMalus}`)
    if(result.score.duplicatedPaths.length) {
        console.log(`Detailed duplicated paths : ${JSON.stringify(result.score.duplicatedPaths)}`)
    }
    console.log('')

    result.score.groupsScores.forEach((groupScore, idx) => {
        console.log(`${groupScore.name} same projects #: tot=${groupScore.sameProjectsCounts}`)
    })

    console.log('')

    console.log("members (to import in google spreadsheet, through Actions > Import fill-groups JSON menu): ")
    console.log(JSON.stringify(result.devs))

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

function scoreOf(devs: CommunityMemberWithAssignedGroupId[], groups: CommunityGroup[], referenceYearForSeniority: number, xpWeight: number, malusPerSamePath: number): ResultDetailedScore {
    const result = groups.reduce((result, group) => {
        // only devs are counting in the score (tech lead XP is not taken into account)
        const groupXPs = devs.filter(d => d.group === group.id && d.type === 'DEV').map(d => xpOf(d, referenceYearForSeniority))
        const groupTotalXP = groupXPs.reduce((total, years) => total+years, 0);
        const groupAverageXP = Math.round(groupTotalXP*100 / groupXPs.length)/100;

        const groupMembers = devs.filter(d => d.group === group.id);
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
    }, { score: 0.0, groupsScores: [], alreadyEncounteredPaths: new Map<string, CommunityMemberWithAssignedGroupId[]>(), samePaths: [] } as { score: number, groupsScores: GroupScore[], alreadyEncounteredPaths: Map<string, CommunityMemberWithAssignedGroupId[]>, samePaths: DuplicatedPath[] });

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

function shuffledDevsMatchesConstraint(devs: CommunityMemberWithAssignedGroupId[], groups: CommunityGroup[], maxSameProjectPerGroup: number, maxMembersPerGroupWithDuplicatedProject: number): boolean {
    const result = groups.reduce((result, group) => {
        const projects = devs.filter(d => d.group === group.id)
            .map((d, idx) => d.mainProject==='*'?'project '+idx:d.mainProject);

        const projectCounts = projects.reduce((projectCounts, project) => {
            projectCounts.set(project, (projectCounts.get(project) || 0)+1);
            return projectCounts;
        }, new Map<string, number>());

        const membersHavingSameProjectCount = projects.length - projectCounts.size;
        const maxDuplicates: number = Math.max.apply(null, Array.from(projectCounts.values()))
        return {
            membersHavingSameProjectMaxPerGroupCount: Math.max(result.membersHavingSameProjectMaxPerGroupCount, membersHavingSameProjectCount),
            maxDuplicates: Math.max(maxDuplicates, result.maxDuplicates)
        };
    }, { membersHavingSameProjectMaxPerGroupCount: 0, maxDuplicates: 0 });

    return result.membersHavingSameProjectMaxPerGroupCount <= maxMembersPerGroupWithDuplicatedProject && result.maxDuplicates <= maxSameProjectPerGroup;
}

async function main() {
    const communityDescriptor: CommunityDescriptor = require('./community-descriptor.json');
    const results = await shuffleGroupsFor(communityDescriptor);
    console.log(results);
}

main()
