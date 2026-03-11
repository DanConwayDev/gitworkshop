import React, { useEffect, useMemo } from "react";
import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useActiveAccount } from "applesauce-react/hooks";
import { useMyProfile } from "@/hooks/useProfile";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/components/ui/button";
import { runner, Actions } from "@/services/actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import type { ProfileContent } from "applesauce-core/helpers";
import { z } from "zod";

// Validation schema for profile metadata
const metadataSchema = z.object({
  name: z.string().optional(),
  display_name: z.string().optional(),
  about: z.string().optional(),
  picture: z
    .string()
    .refine((val) => !val || z.string().url().safeParse(val).success, {
      message: "Must be a valid URL",
    })
    .optional(),
  banner: z
    .string()
    .refine((val) => !val || z.string().url().safeParse(val).success, {
      message: "Must be a valid URL",
    })
    .optional(),
  website: z
    .string()
    .refine((val) => !val || z.string().url().safeParse(val).success, {
      message: "Must be a valid URL",
    })
    .optional(),
  lud16: z
    .string()
    .refine((val) => !val || z.string().email().safeParse(val).success, {
      message: "Must be a valid email address",
    })
    .optional(),
  lud06: z
    .string()
    .refine((val) => !val || z.string().email().safeParse(val).success, {
      message: "Must be a valid email address",
    })
    .optional(),
  nip05: z.string().optional(),
  bot: z.boolean().optional(),
  languages: z.array(z.string()).optional(),
});

type ProfileFormData = z.infer<typeof metadataSchema>;

export const EditProfileForm: React.FC = () => {
  const activeAccount = useActiveAccount();
  const profile = useMyProfile();
  const { toast } = useToast();

  // Convert profile to form data, handling undefined values
  const defaultValues = useMemo<ProfileFormData>(() => {
    if (!profile) {
      return {
        name: "",
        display_name: "",
        about: "",
        picture: "",
        banner: "",
        website: "",
        lud16: "",
        lud06: "",
        nip05: "",
        bot: false,
        languages: [],
      };
    }

    return {
      name: profile.name || "",
      display_name: profile.display_name || profile.displayName || "",
      about: profile.about || "",
      picture: profile.picture || profile.image || "",
      banner: profile.banner || "",
      website: profile.website || "",
      lud16: profile.lud16 || "",
      lud06: profile.lud06 || "",
      nip05: profile.nip05 || "",
      bot: profile.bot || false,
      languages: profile.languages || [],
    };
  }, [profile]);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(metadataSchema),
    defaultValues,
    mode: "onChange",
  });

  // Watch form values for live preview
  const watchedValues = useWatch({ control });

  // Reset form when profile loads
  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const [isPending, setIsPending] = React.useState(false);

  const onSubmit = async (data: ProfileFormData) => {
    if (!activeAccount) {
      toast({
        title: "Error",
        description: "You must be logged in to update your profile",
        variant: "destructive",
      });
      return;
    }

    setIsPending(true);

    try {
      // Convert form data to ProfileContent, removing empty strings
      const profileUpdate: Partial<ProfileContent> = {};

      if (data.name) profileUpdate.name = data.name;
      if (data.display_name) profileUpdate.display_name = data.display_name;
      if (data.about) profileUpdate.about = data.about;
      if (data.picture) profileUpdate.picture = data.picture;
      if (data.banner) profileUpdate.banner = data.banner;
      if (data.website) profileUpdate.website = data.website;
      if (data.lud16) profileUpdate.lud16 = data.lud16;
      if (data.lud06) profileUpdate.lud06 = data.lud06;
      if (data.nip05) profileUpdate.nip05 = data.nip05;
      if (data.bot !== undefined) profileUpdate.bot = data.bot;
      if (data.languages && data.languages.length > 0)
        profileUpdate.languages = data.languages;

      // Use UpdateProfile action from applesauce-actions
      await runner.run(Actions.UpdateProfile, profileUpdate);

      toast({
        title: "Success",
        description: "Your profile has been updated",
      });
    } catch (error) {
      console.error("Failed to update profile:", error);
      toast({
        title: "Error",
        description: "Failed to update your profile. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  };

  // Get current values for preview
  const currentBanner = watchedValues.banner || profile?.banner || "";
  const currentPicture =
    watchedValues.picture || profile?.picture || profile?.image || "";
  const currentDisplayName =
    watchedValues.display_name ||
    profile?.display_name ||
    profile?.displayName ||
    "";
  const currentName = watchedValues.name || profile?.name || "";
  const currentWebsite = watchedValues.website || profile?.website || "";
  const currentNip05 = watchedValues.nip05 || profile?.nip05 || "";
  const currentLud16 = watchedValues.lud16 || profile?.lud16 || "";
  const currentLud06 = watchedValues.lud06 || profile?.lud06 || "";

  return (
    <div className="container mx-auto my-8 px-4 max-w-4xl">
      <form onSubmit={handleSubmit(onSubmit)}>
        {/* Profile Preview Layout */}
        <div className="bg-card rounded-lg overflow-hidden border">
          {/* Banner */}
          <div className="relative h-48 bg-muted">
            {currentBanner ? (
              <img
                src={currentBanner}
                alt="Banner"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-muted/50" />
            )}
            <div className="absolute bottom-0 left-6 transform translate-y-1/2">
              {/* Avatar */}
              <div className="w-32 h-32 rounded-full bg-background p-1 ring-4 ring-background">
                {currentPicture ? (
                  <img
                    src={currentPicture}
                    alt="Avatar"
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full rounded-full bg-muted flex items-center justify-center text-4xl">
                    {currentDisplayName?.[0]?.toUpperCase() ||
                      currentName?.[0]?.toUpperCase() ||
                      "?"}
                  </div>
                )}
              </div>
            </div>
            {/* Banner URL input */}
            <div className="absolute top-2 right-2">
              <Controller
                name="banner"
                control={control}
                render={({ field }) => (
                  <Input
                    type="url"
                    {...field}
                    placeholder="Banner URL"
                    className={`bg-background/90 backdrop-blur-sm w-48 ${
                      errors.banner ? "border-destructive" : ""
                    }`}
                  />
                )}
              />
            </div>
          </div>

          {/* Profile Header */}
          <div className="pt-20 px-6 pb-4">
            {/* Avatar URL input */}
            <div className="mb-4">
              <label className="text-muted-foreground text-sm mb-1 block">
                Avatar URL
              </label>
              <Controller
                name="picture"
                control={control}
                render={({ field }) => (
                  <Input
                    type="url"
                    {...field}
                    placeholder="https://example.com/avatar.jpg"
                    className={errors.picture ? "border-destructive" : ""}
                  />
                )}
              />
              {errors.picture && (
                <span className="text-destructive text-sm">
                  {errors.picture.message}
                </span>
              )}
            </div>

            {/* Display Name and Name as Title */}
            <div className="mb-4">
              <Controller
                name="display_name"
                control={control}
                render={({ field }) => (
                  <Input
                    type="text"
                    {...field}
                    placeholder="Display Name"
                    className={`text-3xl font-bold bg-transparent border-none p-0 w-full focus-visible:ring-2 focus-visible:ring-ring rounded px-2 -ml-2 h-auto ${
                      errors.display_name ? "text-destructive" : ""
                    }`}
                  />
                )}
              />
              {errors.display_name && (
                <span className="text-destructive text-sm">
                  {errors.display_name.message}
                </span>
              )}
              <Controller
                name="name"
                control={control}
                render={({ field }) => (
                  <Input
                    type="text"
                    {...field}
                    placeholder="Name"
                    className={`text-xl text-muted-foreground bg-transparent border-none p-0 w-full focus-visible:ring-2 focus-visible:ring-ring rounded px-2 -ml-2 mt-1 h-auto ${
                      errors.name ? "text-destructive" : ""
                    }`}
                  />
                )}
              />
              {errors.name && (
                <span className="text-destructive text-sm">
                  {errors.name.message}
                </span>
              )}
            </div>

            {/* About */}
            <div className="mb-4">
              <Controller
                name="about"
                control={control}
                render={({ field }) => (
                  <Textarea
                    {...field}
                    placeholder="Tell us about yourself"
                    className={`w-full min-h-24 p-0 border-none focus-visible:ring-2 focus-visible:ring-ring rounded px-2 -ml-2 resize-none ${
                      errors.about ? "border-destructive" : ""
                    }`}
                  />
                )}
              />
              {errors.about && (
                <span className="text-destructive text-sm">
                  {errors.about.message}
                </span>
              )}
            </div>

            {/* Contact Details */}
            <div className="space-y-2 mb-4">
              {currentWebsite && (
                <div>
                  <a
                    href={currentWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {currentWebsite}
                  </a>
                </div>
              )}
              {currentNip05 && (
                <div className="text-muted-foreground">{currentNip05}</div>
              )}
              {currentLud16 && (
                <div className="text-muted-foreground">⚡ {currentLud16}</div>
              )}
              {currentLud06 && (
                <div className="text-muted-foreground">⚡ {currentLud06}</div>
              )}
            </div>

            {/* Additional Fields */}
            <div className="space-y-3 border-t pt-4">
              <div>
                <label className="text-muted-foreground text-sm mb-1 block">
                  Website
                </label>
                <Controller
                  name="website"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="url"
                      {...field}
                      placeholder="https://example.com"
                      className={errors.website ? "border-destructive" : ""}
                    />
                  )}
                />
                {errors.website && (
                  <span className="text-destructive text-sm">
                    {errors.website.message}
                  </span>
                )}
              </div>

              <div>
                <label className="text-muted-foreground text-sm mb-1 block">
                  NIP-05
                </label>
                <Controller
                  name="nip05"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="text"
                      {...field}
                      placeholder="_@domain.com or user@domain.com"
                      className={errors.nip05 ? "border-destructive" : ""}
                    />
                  )}
                />
                {errors.nip05 && (
                  <span className="text-destructive text-sm">
                    {errors.nip05.message}
                  </span>
                )}
              </div>

              <div>
                <label className="text-muted-foreground text-sm mb-1 block">
                  Lightning Address (LUD-16)
                </label>
                <Controller
                  name="lud16"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="email"
                      {...field}
                      placeholder="user@domain.com"
                      className={errors.lud16 ? "border-destructive" : ""}
                    />
                  )}
                />
                {errors.lud16 && (
                  <span className="text-destructive text-sm">
                    {errors.lud16.message}
                  </span>
                )}
              </div>

              <div>
                <label className="text-muted-foreground text-sm mb-1 block">
                  Lightning Address (LUD-06)
                </label>
                <Controller
                  name="lud06"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="email"
                      {...field}
                      placeholder="user@domain.com"
                      className={errors.lud06 ? "border-destructive" : ""}
                    />
                  )}
                />
                {errors.lud06 && (
                  <span className="text-destructive text-sm">
                    {errors.lud06.message}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Controller
                  name="bot"
                  control={control}
                  render={({ field }) => (
                    <Checkbox
                      checked={field.value || false}
                      onCheckedChange={field.onChange}
                      id="bot"
                    />
                  )}
                />
                <label
                  htmlFor="bot"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Bot Account
                </label>
              </div>

              <div>
                <label className="text-muted-foreground text-sm mb-1 block">
                  Languages
                </label>
                <Controller
                  name="languages"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="text"
                      value={field.value?.join(", ") || ""}
                      onChange={(e) => {
                        const languages = e.target.value
                          .split(",")
                          .map((lang) => lang.trim())
                          .filter((lang) => lang.length > 0);
                        field.onChange(languages.length > 0 ? languages : []);
                      }}
                      placeholder="en, ja, es-AR"
                    />
                  )}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="mt-6">
          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={isPending || !isDirty}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Profile"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
};
