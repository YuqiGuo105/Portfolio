import PlatformInteractiveArchitectureLab from "./PlatformInteractiveArchitectureLab";

const EXPERIENCES = {
  PLATFORM_SYSTEM_MAP: PlatformInteractiveArchitectureLab,
};

export default function ProjectExperience({ variant, systems }) {
  const Experience = EXPERIENCES[variant];
  return Experience ? <Experience systems={systems} /> : null;
}
