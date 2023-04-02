
const fs = require('node:fs');
const data = require("./community-descriptor.json");

const fisherYatesShuffle = require ('fisher-yates');
const player = require('play-sound')({});

const BEST_RESULT_FILE = './best-result.json'
let bestResultContent;
try {
    bestResultContent = require(BEST_RESULT_FILE).devs;
}catch(e) {
    bestResultContent = undefined;
}
const INITIAL_MEMBERS_RESULT = bestResultContent;

async function bestShuffleFor(devs, groups, shuffleCount, referenceYearForSeniority, xpWeight, projectCountWeight, maxDiffProjects, maxSameProjectPerGroup, malusPerSamePath) {
    let bestResult = {devs: [], score: {score: Infinity}};

    let lastIndex = 0, lastTS = Date.now(), idx = 0;
    const alreadyProcessedFootprints = new Set();
    for await (const { assignedMembers, footprint } of shuffle(devs, groups)) {
        if(INITIAL_MEMBERS_RESULT && idx===0) {
            assignedMembers.length = 0;
            Array.prototype.push.apply(assignedMembers, INITIAL_MEMBERS_RESULT.map(m => ({...m, group: groups.find(g => g.name === m.group).id})))
        }

        if(!alreadyProcessedFootprints.has(footprint)) {
            alreadyProcessedFootprints.add(footprint);

            if(shuffledDevsMatchesConstraint(assignedMembers, groups, maxDiffProjects, maxSameProjectPerGroup)) {
                const score = scoreOf(assignedMembers, groups, referenceYearForSeniority, xpWeight, projectCountWeight, maxDiffProjects, malusPerSamePath);
                const result = { score, devs: assignedMembers.map(d => ({...d, group: groups.find(g => g.id === d.group).name })) };
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
            console.log(`[${new Date(currentTS).toISOString()}] ${currentTS-lastTS}ms elapsed => ${Math.round((idx-lastIndex)*1000/(currentTS-lastTS))} attemps/sec`)
            lastIndex = idx; lastTS = currentTS;
        }

    }

    return bestResult;
}


async function shuffleGroupsFor(withoutIgnoredDevs, groups, shuffleCount, referenceYearForSeniority, xpWeight, projectCountWeight, maxDiffProjects, maxSameProjectPerGroup, malusPerSamePath) {
    const shuffledDevs = await bestShuffleFor(withoutIgnoredDevs, groups, shuffleCount, referenceYearForSeniority, xpWeight, projectCountWeight, maxDiffProjects, maxSameProjectPerGroup, malusPerSamePath);
    if(!shuffledDevs) {
        return ["Nothing found matching constraints !"];
    }

    onResultFound(shuffledDevs);
}

function onResultFound(result) {
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

function stddev (array) {
    const n = array.length;
    const mean = array.reduce((a, b) => a + b) / n;
    return Math.sqrt(array.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
}

function* shuffle(members, groups){
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
        const shuffledDevIndexes = fisherYatesShuffle(devIndexes.slice(0)),
              shuffledTechleadIndexes = fisherYatesShuffle(techleadIndexes.slice(0));

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
        }, [])

        yield { assignedMembers, footprint };
    }
}

function scoreOf(devs, groups, referenceYearForSeniority, xpWeight, projectCountWeight, maxDiffProjects, malusPerSamePath) {
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
                        result.samePaths.push({ path, email: membersSharingSamePath[0] });
                    }
                    result.samePaths.push({ path, email: m.email });
                    membersSharingSamePath.push(m.email);
                } else {
                    result.alreadyEncounteredPaths.set(path, [m.email]);
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
    }, { score: 0.0, groupsScores: [], alreadyEncounteredPaths: new Map(), samePaths: [] });

    result.xpStdDev = stddev(result.groupsScores.map(gs => gs.groupAverageXP * xpWeight));
    result.duplicatedPaths = result.samePaths;
    result.duplicatedPathsMalus = result.duplicatedPaths.length * malusPerSamePath;
    result.score = result.xpStdDev + result.duplicatedPathsMalus;

    return result;
}

function shuffledDevsMatchesConstraint(devs, groups, maxDiffProjects, maxSameProjectPerGroup) {
    const result = groups.reduce((result, group) => {
        const projects = devs.filter(d => d.group === group.id)
            .map((d, idx) => d.mainProject==='*'?'project '+idx:d.mainProject);
        const maxDuplicates = Math.max.apply(null, projects.map(p1 => projects.filter(p2 => p1 === p2).length))
        const sameProjectsCounts = projects.length - new Set(projects).size;
        return { total: result.total+sameProjectsCounts, maxDuplicates: Math.max(maxDuplicates, result.maxDuplicates) };
    }, { total: 0, maxDuplicates: 0 });

    /*
      const groupPathsStats = devs.reduce((stats, dev) => {
        const devGroupPath = `${dev.latestGroups.join(",")},${dev.group}`;
        const groupPathCount = (stats.groupPaths.get(devGroupPath) || 0)+1
        stats.groupPaths.set(devGroupPath, groupPathCount)
        return { ...stats, max: Math.max(stats.max, groupPathCount) };
      }, { groupPaths: new Map(), max: 0 })
      */

    return result.total <= maxDiffProjects && result.maxDuplicates <= maxSameProjectPerGroup /* && groupPathsStats.max === 1 */;
}

async function main() {
    const data = require('./community-descriptor.json');
    const results = await shuffleGroupsFor(data.devs, data.groups, 1000000000, 2023, 1.5, 1, 6, 2, 0.04);
    console.log(results);
}

main().then(() => {
    console.log('ended')
})
