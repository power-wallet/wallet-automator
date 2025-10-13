// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IWalletFactory {
  function getUsers() external view returns (address[] memory);
  function getUserWallets(address user) external view returns (address[] memory);
}


