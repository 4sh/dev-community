
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
    // If set to 3, it means that within the group, we won't be able
    // to have more than 3 members belonging to the same project
    maxSameProjectPerGroup: number,
    // If set to 2, it means that if we have 7 members in the group,
    // those members will have to be distributed across minimum 7-2=5
    // different groups
    maxMembersPerGroupWithDuplicatedProject: number,
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
    firstName: string,
    lastName: string
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
