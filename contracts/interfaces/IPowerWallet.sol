// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPowerWallet {
  function isClosed() external view returns (bool);
  function automationPaused() external view returns (bool);
  function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData);
  function performUpkeep(bytes calldata performData) external;
}


