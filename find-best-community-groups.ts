/// <reference path="find-best-community-groups.d.ts" />

import * as fs from 'node:fs'
import fisherYatesShuffle from 'fisher-yates'
import playerFactory from 'play-sound'

const player = playerFactory({});

const BEST_RESULT_FILE = './best-result.json'
let bestResultContent: CommunityMemberWithAssignedGroupName[]|undefined;
try {
    bestResultContent = require(BEST_RESULT_FILE).devs;
}catch(e) {
    bestResultContent = undefined;
}
const INITIAL_MEMBERS_RESULT = bestResultContent;

async function bestShuffleFor({devs, groups, referenceYearForSeniority, xpWeight, maxSameProjectPerGroup, maxMembersPerGroupWithDuplicatedProject, malusPerSamePath}: CommunityDescriptor): Promise<Result> {
    let bestResult: Result = {devs: [], score: {score: Infinity, groupsScores:[], duplicatedPathsMalus: 0, duplicatedPaths: [], xpStdDev: 0}};

    let lastIndex = 0, lastTS = Date.now(), idx = 0, attemptsMatchingConstraints = 0, lastAttemptsMatchingConstraints = 0;
    const alreadyProcessedFootprints = new Set<string>();
    for await (const { assignedMembers, footprint } of shuffle(devs, groups)) {
        if(INITIAL_MEMBERS_RESULT && idx===0) {
            assignedMembers.length = 0;
            Array.prototype.push.apply(assignedMembers, INITIAL_MEMBERS_RESULT.map(m => ({...m, group: groups.find(g => g.name === m.group).id})))
        }

        if(!alreadyProcessedFootprints.has(footprint)) {
            alreadyProcessedFootprints.add(footprint);

            if(shuffledDevsMatchesConstraint(assignedMembers, groups, maxSameProjectPerGroup, maxMembersPerGroupWithDuplicatedProject)) {
                attemptsMatchingConstraints++;

                const score = scoreOf(assignedMembers, groups, referenceYearForSeniority, xpWeight, malusPerSamePath);
                const result: Result = { score, devs: assignedMembers.map(d => ({...d, group: groups.find(g => g.id === d.group).name })) };
                if(bestResult.score.score > score.score) {
                    bestResult = result;
                    console.log(`[${idx}] Found new matching result with score of ${bestResult.score.score} !`)
                    onResultFound(bestResult);
                } else {
                    console.log(`[${idx}] Found new matching result, but not beating actual score...`)
                }
            }
        } else {
            console.log(`skipped (footprint already processed !)`)
        }

        idx++;

        if(idx % 1000000 === 0) {
            const currentTS = Date.now();
            const attempsPerSecond = Math.round((idx-lastIndex)*1000/(currentTS-lastTS));
            const attempsMatchingConstraintsPerSecond = Math.round((attemptsMatchingConstraints-lastAttemptsMatchingConstraints)*1000/(currentTS-lastTS));

            console.log(`[${new Date(currentTS).toISOString()}] [${idx}] ${currentTS-lastTS}ms elapsed => ${attempsPerSecond} attempts/sec, ${attempsMatchingConstraintsPerSecond} matching attempts/sec`)
            lastIndex = idx; lastTS = currentTS; lastAttemptsMatchingConstraints = attemptsMatchingConstraints;
        }

    }

    return bestResult;
}


async function shuffleGroupsFor(communityDescriptor: CommunityDescriptor) {
    const result = await bestShuffleFor(communityDescriptor);
    if(!result) {
        return ["Nothing found matching constraints !"];
    }

    onResultFound(result);
}

function onResultFound(result: Result) {
    fs.writeFileSync(BEST_RESULT_FILE, JSON.stringify(result, null, '  '));

    console.log(`Écart-type avg(XP) des groupes : ${result.score.xpStdDev}`)
    console.log(`Malus duplicated paths : ${result.score.duplicatedPathsMalus}`)
    console.log('')
    console.log(`Detailed duplicated paths : ${JSON.stringify(result.score.duplicatedPaths)}`)
    console.log('')

    result.score.groupsScores.forEach((groupScore, idx) => {
        console.log(`${groupScore.name} XP: tot=${groupScore.groupTotalXP}, avg=${groupScore.groupAverageXP}`)
    })

    console.log('')

    result.score.groupsScores.forEach((groupScore, idx) => {
        console.log(`${groupScore.name} same projects #: tot=${groupScore.sameProjectsCounts}`)
    })

    console.log('')

    console.log("devs: ")
    console.log(JSON.stringify(result.devs))

    player.play('mixkit-gaming-lock-2848.wav')
}

function stddev (array: number[]): number {
    const n = array.length;
    const mean = array.reduce((a, b) => a + b) / n;
    return Math.sqrt(array.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
}

function* shuffle(members: CommunityMember[], groups: CommunityGroup[]){
    const animators = members.filter(m => m.isAnimator);
    if(animators.length !== groups.length) {
        throw new Error(`Number of animators ${animators.length} is different than the groups' size (${groups.length})`)
    }

    const devs = members.filter(m => !m.isAnimator && m.type === 'DEV');
    const techleads = members.filter(m => !m.isAnimator && m.type === 'TECHLEAD');

    const devIndexes = devs.map((_, idx) => idx),
        techleadIndexes = techleads.map((_, idx) => idx);

    while(true) {
        // cloning arrays
        const shuffledDevIndexes: typeof devIndexes = fisherYatesShuffle(devIndexes.slice(0)),
              shuffledTechleadIndexes: typeof techleadIndexes = fisherYatesShuffle(techleadIndexes.slice(0));

        const footprint = shuffledDevIndexes.concat(shuffledTechleadIndexes).join(",");

        const assignedMembers = groups.reduce((assignedMembers, group, groupIdx) => {
            const animator = animators[groupIdx];
            assignedMembers.push({
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

            for(let i=0; i<group.techleadsCount - (animator.type === 'TECHLEAD'?1:0); i++) {
                const tcIndex = shuffledTechleadIndexes.shift();
                const techlead = techleads[tcIndex];
                assignedMembers.push({
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
            }

            for(let i=0; i<group.devsCount - (animator.type === 'DEV'?1:0); i++) {
                const devIndex = shuffledDevIndexes.shift();
                const dev = devs[devIndex];
                assignedMembers.push({
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
            }

            return assignedMembers;
        }, [] as CommunityMemberWithAssignedGroupId[])

        yield { assignedMembers, footprint };
    }
}

function scoreOf(devs: CommunityMemberWithAssignedGroupId[], groups: CommunityGroup[], referenceYearForSeniority: number, xpWeight: number, malusPerSamePath: number): ResultDetailedScore {
    const result = groups.reduce((result, group) => {
        // only devs are counting in the score (tech lead XP is not taken into account)
        const groupXPs = devs.filter(d => d.group === group.id && d.type === 'DEV').map(d => referenceYearForSeniority - d.proStart)
        const groupTotalXP = groupXPs.reduce((total, years) => total+years, 0);
        const groupAverageXP = Math.round(groupTotalXP*100 / groupXPs.length)/100;

        const groupMembers = devs.filter(d => d.group === group.id);
        groupMembers.forEach(m => {
            // Members having "empty" past group should be ignored
            if(!m.latestGroups.filter(lg => lg === '').length) {
                const path = m.latestGroups.concat([group.name]).join("|")
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

main().then(() => {
    console.log('ended')
})
