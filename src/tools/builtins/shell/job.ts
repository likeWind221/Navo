const JOB_TYPE = "NavoShellJobV1";

const JOB_SOURCE = `using System;
using System.Runtime.InteropServices;
public static class ${JOB_TYPE} {
  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimits {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimits {
    public BasicLimits Basic;
    public IoCounters Io;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint length);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();
  static IntPtr job;
  public static void Enter() {
    IntPtr handle = CreateJobObjectW(IntPtr.Zero, null);
    if (handle == IntPtr.Zero) throw new InvalidOperationException("CreateJobObject " + Marshal.GetLastWin32Error());
    ExtendedLimits limits = new ExtendedLimits();
    limits.Basic.LimitFlags = 0x2000;
    if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))))
      throw new InvalidOperationException("SetInformationJobObject " + Marshal.GetLastWin32Error());
    if (!AssignProcessToJobObject(handle, GetCurrentProcess()))
      throw new InvalidOperationException("AssignProcessToJobObject " + Marshal.GetLastWin32Error());
    job = handle;
  }
}`;

export function jobPrelude(jobDir: string): string {
  const dir = quoted(jobDir);
  return "& { try { "
    + `$dll = [IO.Path]::Combine(${dir}, 'navo-job-v1-' + $PSVersionTable.PSEdition + '.dll'); `
    + "if (-not [IO.File]::Exists($dll)) { "
    + `$null = [IO.Directory]::CreateDirectory(${dir}); `
    + "$tmp = $dll + '.' + [guid]::NewGuid().ToString('N') + '.tmp'; "
    + `Add-Type -TypeDefinition ${quoted(JOB_SOURCE)} -OutputAssembly $tmp -ErrorAction Stop; `
    + "try { [IO.File]::Move($tmp, $dll) } catch { [IO.File]::Delete($tmp) } }; "
    + `$null = [Reflection.Assembly]::LoadFrom($dll).GetType('${JOB_TYPE}', $true).GetMethod('Enter').Invoke($null, $null) `
    + "} catch {} }; ";
}

function quoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
