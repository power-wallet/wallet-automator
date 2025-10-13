// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal Chainlink Automation interface to avoid external package pinning issues.
interface IAutomationCompatible {
  /// checkUpkeep is simulated off-chain by Automation.
  /// Return upkeepNeeded true if performUpkeep should be called, with optional performData.
  function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData);

  /// performUpkeep is executed on-chain by Automation when upkeepNeeded is true.
  function performUpkeep(bytes calldata performData) external;
}


