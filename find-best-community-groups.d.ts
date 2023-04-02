
declare type CommunityMember = {
    lastName: string,
    firstName: string,
    type: string,
    email: string,
    proStart: number,
    isAnimator: boolean,
    mainProject: string,
    latestGroups: string[]
}
declare type CommunityGroup = {
    id: number,
    name: string,
    devsCount: number,
    techleadsCount: number
}
declare type CommunityDescriptor = {
    referenceYearForSeniority: number,
    xpWeight: number,
    maxSameProjectPerGroup: number,
    malusPerSamePath: number,
    devs: Array<CommunityMember>,
    groups: Array<CommunityGroup>
}

declare type CommunityMemberWithAssignedGroupId = CommunityMember & {group: number};
declare type CommunityMemberWithAssignedGroupName = CommunityMember & {group: string};

declare type GroupScore = {
    name: string,
    groupXPs: number[],
    groupTotalXP: number,
    groupAverageXP: number,
    projects: string[],
    sameProjectsCounts: number
}

declare type DuplicatedPath = {
    path: string,
    email: string
}

declare type ResultDetailedScore = {
    score: number,
    xpStdDev: number,
    duplicatedPaths: DuplicatedPath[],
    duplicatedPathsMalus: number,
    groupsScores: GroupScore[]
}
declare type Result = {
    score: ResultDetailedScore,
    devs: CommunityMemberWithAssignedGroupName[]
}
