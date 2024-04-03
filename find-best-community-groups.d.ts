
declare type CommunityMember = {
    lastName: string,
    firstName: string,
    type: "DEV"|"TECHLEAD",
    trigram: string,
    proStart: number,
    mainProject: string,
    latestGroups: string[]
}
declare type CommunityGroup = {
    name: string,
    devsCount: number,
    techleadsCount: number,
    animator?: string|null
}
declare type RawTrackDescriptor = {
  name: string,
  subscribers: string,
  alsoIncludeUnsubscribedMembers?: boolean,
  groups: Array<CommunityGroup>
}
declare type TrackDescriptor = {
  name: string,
  subscribers: Array<CommunityMember>,
  groups: Array<CommunityGroup>
}
declare type RawCommunityDescriptor = {
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
    tracks: Array<RawTrackDescriptor>,
}
declare type CommunityDescriptor = Omit<RawCommunityDescriptor, "tracks"> & {
  tracks: Array<TrackDescriptor>
}

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
  communityDescriptor: Omit<CommunityDescriptor, "tracks">,
  trackResults: TrackResult[],
}
declare type TrackResult = {
    track: TrackDescriptor,
    score: ResultDetailedScore,
    members: CommunityMemberWithAssignedGroupName[]
}
