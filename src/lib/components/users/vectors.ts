import type { User } from "./type";

// nsec1rg53qfv09az39dlw6j64ange3cx8sh5p8np29qcxtythplvplktsv93tnr
let base: User = {
    hexpubkey:
        "3eb45c6f15752d796fa5465d0530a5a5feb79fb6f08c0a4176be9d73cc28c40d",
    npub: "npub18669cmc4w5khjma9gews2v995hlt08ak7zxq5stkh6wh8npgcsxslt2xjn",
    loading: false,
};

let image = "../test-profile-image.jpg";

export let UserVectors = {
    loading: { ...base, loading: true } as User,
    default: { ...base, profile: { name: "DanConwayDev", image } } as User,
    display_name_only: { ...base, profile: { displayName: "DanConwayDev", image } } as User,
    display_name_and_name: { ...base, profile: { name: "Dan", displayName: "DanConwayDev", image } } as User,
    no_image: { ...base, profile: { name: "DanConwayDev" } } as User,
    no_profile: { ...base } as User,
};

export function withName(base: User, name: string): User {
    return {
        ...base,
        profile: {
            ...base.profile,
            name,
        }
    } as User
}
