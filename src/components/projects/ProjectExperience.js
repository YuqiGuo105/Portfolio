import PlatformArchitectureExperience from "./PlatformArchitectureExperience";

const EXPERIENCES = {
  PLATFORM_SYSTEM_MAP: PlatformArchitectureExperience,
};

export default function ProjectExperience({ variant, systems }) {
  const Experience = EXPERIENCES[variant];
  return Experience ? <Experience systems={systems} /> : null;
}
